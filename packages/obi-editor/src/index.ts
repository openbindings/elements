import {
  formatValidationErrors,
  type OBInterface,
  validateDocument,
} from "@openbindings/sdk";
import { OpenBindingsElement, baseStyles } from "@openbindings/ui-core";
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
  #result: ParseResult = {
    valid: false,
    error: "No interface document loaded.",
  };
  #textarea: HTMLTextAreaElement | null = null;
  #formatSelect: HTMLSelectElement | null = null;
  #status: HTMLElement | null = null;
  #reset: HTMLButtonElement | null = null;

  constructor() {
    super();
    const root = this.renderRoot;
    if (!root) return;
    root.innerHTML = `<style>${baseStyles}${styles}</style>
      <section class="container" part="container" aria-label="OpenBindings interface source editor">
        <header class="toolbar" part="toolbar">
          <div>
            <p class="eyebrow">Interface document</p>
            <strong>Source</strong>
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
        <textarea
          class="editor"
          part="editor"
          aria-label="OpenBindings interface source"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        ></textarea>
        <footer class="status" part="status" role="status" aria-live="polite"></footer>
      </section>`;
    this.#textarea = root.querySelector(".editor");
    this.#formatSelect = root.querySelector(".format");
    this.#status = root.querySelector(".status");
    this.#reset = root.querySelector(".reset");

    this.#textarea?.addEventListener("input", () => {
      this.#text = this.#textarea?.value ?? "";
      this.#result = parseInterface(this.#text, this.#format);
      this.#update();
      this.#emitEdit();
    });
    this.#textarea?.addEventListener("keydown", event => {
      if (event.key !== "Tab" || this.#readOnly || !this.#textarea) return;
      event.preventDefault();
      const start = this.#textarea.selectionStart;
      const end = this.#textarea.selectionEnd;
      this.#textarea.setRangeText("  ", start, end, "end");
      this.#textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
      this.#textarea?.focus();
    });
  }

  get value(): OBInterface | null {
    return this.#result.valid ? this.#result.value : null;
  }

  set value(value: OBInterface | null) {
    this.#text = value ? formatInterface(value, this.#format) : "";
    this.#baseline = this.#text;
    this.#result = parseInterface(this.#text, this.#format);
    this.requestRender();
  }

  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    this.#text = value ?? "";
    this.#baseline = this.#text;
    this.#result = parseInterface(this.#text, this.#format);
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
    this.#result = parseInterface(this.#text, this.#format);
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
    if (this.#textarea) {
      if (this.#textarea.value !== this.#text) {
        this.#textarea.value = this.#text;
      }
      this.#textarea.readOnly = this.#readOnly;
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

function parseInterface(
  text: string,
  format: OBIDocumentFormat,
): ParseResult {
  if (!text.trim()) {
    return { valid: false, error: "Interface source is empty." };
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
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  .toolbar {
    display: flex;
    gap: var(--ob-space);
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: calc(var(--ob-space) * 0.65) var(--ob-space);
    background: var(--ob-color-surface);
    border-bottom: 1px solid var(--ob-color-border);
  }

  .toolbar p {
    margin: 0;
  }

  .eyebrow {
    color: var(--ob-color-text-muted);
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
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: calc(var(--ob-radius) * 0.65);
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .editor {
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: var(--ob-space);
    resize: none;
    color: var(--ob-color-text);
    background: var(--ob-color-background);
    border: 0;
    border-radius: 0;
    outline: 0;
    font-family: var(--ob-font-mono);
    font-size: 0.78rem;
    line-height: 1.55;
    tab-size: 2;
    white-space: pre;
  }

  .editor:focus-visible {
    box-shadow: inset var(--ob-focus-ring);
  }

  .editor[readonly] {
    color: var(--ob-color-text-muted);
  }

  .status {
    min-height: 2rem;
    padding: 0.4rem var(--ob-space);
    overflow: auto;
    color: var(--ob-color-text-muted);
    background: var(--ob-color-surface);
    border-top: 1px solid var(--ob-color-border);
    font-size: 0.72rem;
    white-space: pre-wrap;
  }

  .status[data-state="valid"] {
    color: var(--ob-color-success);
  }

  .status[data-state="invalid"] {
    color: var(--ob-color-danger);
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
