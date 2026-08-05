import {
  formatValidationErrors,
  type OBInterface,
  parseDocument,
} from "@openbindings/sdk";
import type { JSONEditorElement } from "@openbindings/json-editor";
import {
  OpenBindingsElement,
  adoptStyles,
  baseStyles,
  debounce,
} from "@openbindings/ui-core";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";

export const OBI_EDITOR_TAG = "ob-obi-editor";
export type OBIDocumentFormat = "json" | "yaml";

export type OBIEditorChangeDetail =
  | {
      text: string;
      format: OBIDocumentFormat;
      valid: true;
      dirty: boolean;
      value: OBInterface;
    }
  | {
      text: string;
      format: OBIDocumentFormat;
      valid: false;
      dirty: boolean;
      error: string;
    };

export interface OBIEditorEventMap {
  "ob-interface-edit": CustomEvent<OBIEditorChangeDetail>;
}

interface ParseSuccess {
  valid: true;
  value: OBInterface;
}

interface ParseFailure {
  valid: false;
  error: string;
}

type ParseResult = ParseSuccess | ParseFailure;

export class OBIEditorElement extends OpenBindingsElement {
  #text = "";
  #baseline = "";
  #format: OBIDocumentFormat = "json";
  #readOnly = false;
  #errorLine: number | null = null;
  #result: ParseResult = {
    valid: false,
    error: "No interface document loaded.",
  };
  #editor: JSONEditorElement | null = null;
  // Short trailing debounce: long enough to coalesce a keystroke burst,
  // short enough that the mirror feels instant (rev 17.10 — "It should be
  // instant. Absolutely instant.").
  readonly #scheduleValidation = debounce(() => this.#validateNow(), 50);
  #formatSelect: HTMLSelectElement | null = null;
  #status: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.renderRoot;
    if (!root) return;
    adoptStyles(root, baseStyles, styles);
    root.innerHTML = `
      <section class="container" part="container" aria-label="OpenBindings interface source editor">
        <header class="toolbar" part="toolbar">
          <div>
            <p class="eyebrow">Interface document</p>
          </div>
          <div class="actions">
            <span class="status" part="status" role="status" aria-live="polite" hidden></span>
            <label>
              <span class="sr-only">Document format</span>
              <select class="format" part="format" aria-label="Document format">
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
              </select>
            </label>
          </div>
        </header>
        <ob-json-editor class="editor" part="editor"></ob-json-editor>
      </section>`;
    this.#editor = root.querySelector(".editor");
    this.#formatSelect = root.querySelector(".format");
    this.#status = root.querySelector(".status");

    // Schema validation walks the whole document, so running it per keystroke
    // made typing cost grow with document size. The keystroke now only records
    // the text; validation and the resulting event are debounced, and the
    // editor element handles indentation itself.
    this.#editor?.addEventListener("ob-json-input", event => {
      this.#text = (event as CustomEvent<{ text: string }>).detail.text;
      this.#scheduleValidation();
    });
    this.#formatSelect?.addEventListener("change", () => {
      const next = normalizeFormat(this.#formatSelect?.value);
      if (next === this.#format) return;
      if (this.#result.valid) {
        this.#text = formatInterface(this.#result.value, next);
      }
      this.#format = next;
      this.#result = parseInterface(this.#text, next);
      this.#update();
      this.#emitEdit();
    });
  }

  get value(): OBInterface | null {
    return this.#result.valid ? this.#result.value : null;
  }

  set value(value: OBInterface | null) {
    const formatted = value ? formatInterface(value, this.#format) : "";
    // Echo guard: hosts commit the editor's own edits back as `value` (the
    // living-document reconcile). When the round-trip is byte-identical the
    // only real change is the baseline — skipping the reset keeps the
    // editor's caret, selection, and undo history untouched mid-typing.
    if (formatted === this.#text) {
      this.#baseline = formatted;
      return;
    }
    this.#text = formatted;
    this.#baseline = this.#text;
    this.#scheduleValidation.cancel();
    this.#revalidate();
    this.requestRender();
  }

  /**
   * Accepts the CURRENT text as the committed baseline without touching the
   * buffer. This is the host's acknowledgement for an editor-originated
   * commit (rev 17.10.1): the editor is the source of truth, so committing
   * its own edit must never write a reformatted document back into it —
   * that reset is what yanked the caret to the top of the file mid-typing.
   */
  commitBaseline(): void {
    this.#baseline = this.#text;
  }

  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    this.#text = value ?? "";
    this.#baseline = this.#text;
    this.#scheduleValidation.cancel();
    this.#revalidate();
    this.requestRender();
  }

  /**
   * Reveals a document path in the embedded source editor (rev 17.14):
   * scrolls it into view only when off screen and flashes it, never
   * touching focus or caret. Returns whether the path was found in the
   * current buffer.
   */
  revealPath(path: ReadonlyArray<string | number>): boolean {
    return this.#editor?.revealPath(path) ?? false;
  }

  get format(): OBIDocumentFormat {
    return this.#format;
  }

  set format(value: OBIDocumentFormat) {
    const next = normalizeFormat(value);
    if (next === this.#format) return;
    if (this.#result.valid) {
      this.#text = formatInterface(this.#result.value, next);
      this.#baseline = this.#text;
    }
    this.#format = next;
    this.#scheduleValidation.cancel();
    this.#revalidate();
    this.requestRender();
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  set readOnly(value: boolean) {
    if (Boolean(value) === this.#readOnly) return;
    this.#readOnly = Boolean(value);
    this.requestRender();
  }

  protected override render(): void {
    this.#update();
  }

  #update(): void {
    if (this.#editor) {
      this.#editor.text = this.#text;
      this.#editor.language = this.#format;
      this.#editor.readOnly = this.#readOnly;
      this.#editor.errorLine = this.#result.valid ? null : this.#errorLine;
    }
    if (this.#formatSelect) {
      this.#formatSelect.value = this.#format;
      this.#formatSelect.disabled = this.#readOnly;
    }
    if (this.#status) {
      // Linter doctrine (rev 17.9): validity is silent — only INVALIDITY
      // surfaces, as a toolbar chip carrying the diagnostic in its tooltip
      // (the editor also marks the offending line).
      const result = this.#result;
      this.#status.hidden = result.valid;
      if (!result.valid) {
        this.#status.dataset.state = "invalid";
        this.#status.textContent = "Invalid";
        this.#status.title = result.error;
        this.#status.setAttribute("aria-label", `Invalid: ${result.error}`);
      } else {
        delete this.#status.dataset.state;
        this.#status.textContent = "";
        this.#status.removeAttribute("title");
        this.#status.removeAttribute("aria-label");
      }
    }
  }

  /**
   * Re-parses and validates, then reports. Runs on a trailing debounce from
   * the keystroke path and synchronously from programmatic changes.
   */
  #validateNow(): void {
    this.#revalidate();
    this.#emitEdit();
  }

  /**
   * Re-parses and repaints without reporting. Assigning `value`, `text` or
   * `format` is the application talking to the element, not the author
   * editing — emitting an edit intent there would echo the application's own
   * write back at it.
   */
  #revalidate(): void {
    this.#result = parseInterface(this.#text, this.#format);
    this.#errorLine = this.#result.valid
      ? null
      : errorLineFrom(this.#result.error, this.#text);
    this.#update();
  }

  #emitEdit(): void {
    const common = {
      text: this.#text,
      format: this.#format,
      dirty: this.#text !== this.#baseline,
    };
    if (this.#result.valid) {
      this.emit("ob-interface-edit", {
        ...common,
        valid: true,
        value: this.#result.value,
      });
    } else {
      this.emit("ob-interface-edit", {
        ...common,
        valid: false,
        error: this.#result.error,
      });
    }
  }
}

/**
 * Best-effort 1-based line for a parse failure, so the gutter can point at it.
 * Both JSON.parse and the YAML parser report a position; neither promises a
 * format, so a miss just means no marker rather than a wrong one.
 */
function errorLineFrom(message: string, text: string): number | null {
  const line = /\bline (\d+)/i.exec(message);
  if (line?.[1]) return Number(line[1]);
  const position = /position (\d+)/i.exec(message);
  if (position?.[1]) {
    const offset = Number(position[1]);
    return text.slice(0, offset).split("\n").length;
  }
  return null;
}

function parseInterface(
  text: string,
  format: OBIDocumentFormat,
): ParseResult {
  if (!text.trim()) {
    return { valid: false, error: "The interface document is empty." };
  }
  try {
    // parseDocument = JSON parse + duplicate-key scan + meta-schema check:
    // tens of milliseconds on a large document, so it can ride the keystroke
    // loop. The deep OBI-D rule walk (validateInterface) is SECONDS on the
    // same document and re-compiles per call — it must never sit between a
    // keystroke and the mirror (rev 17.10). Depth is the host's affair: the
    // workbench validates through the contract server-side and reports
    // problems in its document badge.
    if (format === "json") {
      return { valid: true, value: parseDocument(text) };
    }
    const parsed: unknown = parseYAML(text, {
      prettyErrors: true,
      uniqueKeys: true,
    });
    return {
      valid: true,
      value: parseDocument(JSON.stringify(parsed)),
    };
  } catch (error) {
    return { valid: false, error: formatValidationErrors(error) };
  }
}

function formatInterface(
  value: OBInterface,
  format: OBIDocumentFormat,
): string {
  return format === "json"
    ? `${JSON.stringify(value, null, 2)}\n`
    : stringifyYAML(value, { indent: 2, lineWidth: 0 });
}

function normalizeFormat(value: unknown): OBIDocumentFormat {
  if (value === "json" || value === "yaml") return value;
  throw new TypeError('format must be "json" or "yaml"');
}

export interface OBIEditorElement {
  addEventListener<K extends keyof OBIEditorEventMap>(
    type: K,
    listener: (
      this: OBIEditorElement,
      event: OBIEditorEventMap[K],
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "ob-obi-editor": OBIEditorElement;
  }
}

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;
  }

  .container {
    display: grid;
    grid-template-rows: auto minmax(10rem, 1fr);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .toolbar {
    display: flex;
    gap: var(--_ob-space);
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: calc(var(--_ob-space) * 0.65) var(--_ob-space);
    background: var(--_ob-color-surface);
    border-bottom: 1px solid var(--_ob-color-border);
  }

  .toolbar p {
    margin: 0;
  }

  .eyebrow {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  select,
  button {
    min-height: 2rem;
    padding: 0.25rem 0.55rem;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /*
   * Layout only. This class once styled a raw <textarea>; when the embedded
   * ob-json-editor replaced it, the leftover declarations kept styling the
   * HOST — and the inheritable ones (white-space: pre above all) leaked into
   * the child's shadow tree, turning its template whitespace into layout and
   * displacing the click target two lines from the visible text. The element
   * owns its own typography, focus, and readonly presentation.
   */
  .editor {
    width: 100%;
    min-width: 0;
    min-height: 0;
  }

  /* The editor is the pane: no padding band, no inner frame — the code
     surface runs edge to edge under the toolbar (rev 17.9). */
  /* The embedded editor's own frame part is named "frame" — NOT "container"
     (rev 17.11.1: three ::part(container) rules across the repo were silent
     no-ops, which is why every editor kept a second border inside an
     already-framed panel). */
  .editor::part(frame) {
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  /* Invalidity chip: shown only when the document does not parse or
     validate — validity itself is silent, like every linter. */
  .status {
    max-width: 16rem;
    padding: 0.18rem 0.55rem;
    overflow: hidden;
    color: var(--_ob-color-danger);
    background: color-mix(in srgb, var(--_ob-color-danger) 10%, var(--_ob-color-background));
    border: 1px solid color-mix(in srgb, var(--_ob-color-danger) 30%, var(--_ob-color-border));
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status[hidden] {
    display: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
