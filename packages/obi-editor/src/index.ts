import {
  formatValidationErrors,
  type OBInterface,
  validateDocument,
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
  readonly #scheduleValidation = debounce(() => this.#validateNow(), 180);
  #formatSelect: HTMLSelectElement | null = null;
  #status: HTMLElement | null = null;
  #reset: HTMLButtonElement | null = null;

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
            <label>
              <span class="sr-only">Document format</span>
              <select class="format" part="format" aria-label="Document format">
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
              </select>
            </label>
            <button class="reset" part="reset" type="button">Reset</button>
          </div>
        </header>
        <ob-json-editor class="editor" part="editor"></ob-json-editor>
        <footer class="status" part="status" role="status" aria-live="polite"></footer>
      </section>`;
    this.#editor = root.querySelector(".editor");
    this.#formatSelect = root.querySelector(".format");
    this.#status = root.querySelector(".status");
    this.#reset = root.querySelector(".reset");

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
    this.#reset?.addEventListener("click", () => {
      if (this.#readOnly || this.#text === this.#baseline) return;
      this.#text = this.#baseline;
      this.#result = parseInterface(this.#text, this.#format);
      this.#update();
      this.#emitEdit();
      this.#editor?.focusEditor();
    });
  }

  get value(): OBInterface | null {
    return this.#result.valid ? this.#result.value : null;
  }

  set value(value: OBInterface | null) {
    this.#text = value ? formatInterface(value, this.#format) : "";
    this.#baseline = this.#text;
    this.#scheduleValidation.cancel();
    this.#revalidate();
    this.requestRender();
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
    if (this.#reset) {
      this.#reset.disabled = this.#readOnly || this.#text === this.#baseline;
    }
    if (this.#status) {
      const dirty = this.#text !== this.#baseline;
      this.#status.dataset.state = this.#result.valid ? "valid" : "invalid";
      this.#status.textContent = this.#result.valid
        ? dirty
          ? "Valid OpenBindings interface · unsaved changes"
          : "Valid OpenBindings interface"
        : this.#result.error;
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
    if (format === "json") {
      return { valid: true, value: validateDocument(text) };
    }
    const parsed: unknown = parseYAML(text, {
      prettyErrors: true,
      uniqueKeys: true,
    });
    return {
      valid: true,
      value: validateDocument(JSON.stringify(parsed)),
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
    grid-template-rows: auto minmax(10rem, 1fr) auto;
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
    padding: var(--_ob-space);
  }

  .status {
    min-height: 2rem;
    padding: 0.4rem var(--_ob-space);
    overflow: auto;
    color: var(--_ob-color-text-muted);
    background: var(--_ob-color-surface);
    border-top: 1px solid var(--_ob-color-border);
    font-size: 0.72rem;
    white-space: pre-wrap;
  }

  .status[data-state="valid"] {
    color: var(--_ob-color-success);
  }

  .status[data-state="invalid"] {
    color: var(--_ob-color-danger);
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
