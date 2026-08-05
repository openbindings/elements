import {
  CODE_BLOCK_STYLES,
  renderCodeBlock,
} from "@openbindings/json-editor/highlight";
import type { OBInterface } from "@openbindings/sdk";
import {
  OpenBindingsElement,
  Refs,
  adoptStyles,
  baseStyles,
  bindSplitGutter,
  clampSplitRatio,
  railStyles,
  roundSplitRatio,
  splitGutterStyles,
} from "@openbindings/ui-core";

export const SCHEMA_SPLIT_TAG = "ob-schema-split";

/**
 * Same detail family as the workbench's `ob-layout-change`: emitted only
 * for a USER resize of the split gutter. Programmatic `splitRatio`
 * assignment never echoes, so a host can keep several strips on one shared
 * axis without feedback loops.
 */
export interface SchemaSplitLayoutChangeDetail {
  splitRatio: number;
}

export interface SchemaSplitEventMap {
  "ob-layout-change": CustomEvent<SchemaSplitLayoutChangeDetail>;
}

const COPY_FEEDBACK_MS = 1600;

/**
 * An operation's declared input and output schemas as a full-width split of
 * static highlighted code blocks (the code BLOCK tier, rev 17.5) — the
 * contract presented in the same column geometry as the invocation cockpit
 * below it, so input schema sits directly over input and output over
 * output (rev 17.12). The rails carry one verb per side (copy) and exist
 * for alignment as much as utility: their width IS the cockpit rails'
 * width, from the shared ui-core rail contract.
 */
export class SchemaSplitElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #operationKey: string | null = null;
  #splitRatio = 0.5;
  #refs: Refs | null = null;
  #copiedSide: "input" | "output" | null = null;
  #copyTimer: ReturnType<typeof setTimeout> | null = null;

  static get observedAttributes(): string[] {
    return ["flush"];
  }

  attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    value: string | null,
  ): void {
    if (name === "flush") this.flush = value !== null;
  }

  /**
   * Flush presentation, same contract as the workbench (rev 17.7/17.8):
   * the host provides the frame and the height, the element draws no chrome
   * of its own — full-bleed panes, hairline divider. Standalone consumers
   * keep the framed card by default.
   */
  get flush(): boolean {
    return this.hasAttribute("flush");
  }

  set flush(value: boolean) {
    this.toggleAttribute("flush", Boolean(value));
  }

  constructor() {
    super();
    const root = this.renderRoot;
    if (!root) return;
    adoptStyles(
      root,
      baseStyles,
      railStyles,
      splitGutterStyles,
      styles,
      CODE_BLOCK_STYLES,
    );
    root.innerHTML = SHELL;
    this.#refs = new Refs(root);
    this.#bind();
  }

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.requestRender();
  }

  get operationKey(): string | null {
    return this.#operationKey;
  }

  set operationKey(value: string | null) {
    if (value === this.#operationKey) return;
    this.#operationKey = value;
    this.requestRender();
  }

  get splitRatio(): number {
    return this.#splitRatio;
  }

  set splitRatio(value: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("splitRatio must be a finite number");
    }
    const clamped = clampSplitRatio(value);
    if (clamped === this.#splitRatio) return;
    this.#splitRatio = clamped;
    // Assignment never echoes: ob-layout-change is user intent only.
    this.requestRender();
  }

  #bind(): void {
    const refs = this.#refs;
    if (!refs) return;
    refs
      .find(".copy-input")
      ?.addEventListener("click", () => void this.#copy("input"));
    refs
      .find(".copy-output")
      ?.addEventListener("click", () => void this.#copy("output"));
    const gutter = refs.find(".layout-gutter");
    if (gutter) {
      bindSplitGutter(gutter, {
        ratio: () => this.#splitRatio,
        bounds: () => {
          const workspace = refs.find(".workspace");
          if (!workspace) return null;
          const rect = workspace.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        },
        resize: next => {
          this.#splitRatio = next;
          this.requestRender();
        },
        commit: next => {
          this.emit<SchemaSplitLayoutChangeDetail>("ob-layout-change", {
            splitRatio: next,
          });
        },
      });
    }
  }

  #schemaText(side: "input" | "output"): string | null {
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    if (!operation) return null;
    const schema = side === "input" ? operation.input : operation.output;
    if (schema === undefined || schema === null) return null;
    return JSON.stringify(schema, null, 2) ?? null;
  }

  async #copy(side: "input" | "output"): Promise<boolean> {
    const text = this.#schemaText(side);
    if (text === null) return false;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) {
      this.#copiedSide = side;
      if (this.#copyTimer !== null) clearTimeout(this.#copyTimer);
      this.#copyTimer = setTimeout(() => {
        this.#copyTimer = null;
        this.#copiedSide = null;
        this.requestRender();
      }, COPY_FEEDBACK_MS);
      this.requestRender();
    }
    return copied;
  }

  protected render(): void {
    const refs = this.#refs;
    if (!refs) return;
    const empty = refs.find(".empty");
    const workspace = refs.find(".workspace");
    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;

    if (!operation) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = this.#obi
          ? "Select an operation to see its schemas."
          : "Assign an OBI document and operation key.";
      }
      if (workspace) workspace.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (workspace) {
      workspace.hidden = false;
      workspace.style.setProperty("--_ob-split-input", `${this.#splitRatio}fr`);
      workspace.style.setProperty(
        "--_ob-split-output",
        `${roundSplitRatio(1 - this.#splitRatio)}fr`,
      );
    }
    const gutter = refs.find(".layout-gutter");
    gutter?.setAttribute(
      "aria-valuenow",
      String(Math.round(this.#splitRatio * 100)),
    );

    for (const side of ["input", "output"] as const) {
      const text = this.#schemaText(side);
      const block = refs.find<HTMLElement>(`.${side}-schema`);
      const none = refs.find<HTMLElement>(`.${side}-empty`);
      const copy = refs.find<HTMLButtonElement>(`.copy-${side}`);
      if (block) {
        block.hidden = text === null;
        if (text !== null) renderCodeBlock(block, text);
      }
      if (none) none.hidden = text !== null;
      if (copy) {
        // Steady rails (rev 17.9): the verb stays visible, greyed when
        // there is nothing to copy.
        copy.disabled = text === null;
        const copied = this.#copiedSide === side;
        copy.classList.toggle("copied", copied);
        const label = copied ? "Copied" : `Copy ${side} schema as JSON`;
        copy.setAttribute("aria-label", label);
        copy.title = label;
      }
    }
  }
}

function icon(paths: string): string {
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${paths}</svg>`
  );
}

const ICON_COPY = icon(
  '<rect x="8" y="8" width="14" height="14" rx="2" ry="2"/>' +
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
);
const ICON_CHECK = icon('<path d="M20 6 9 17l-5-5"/>');

const SHELL = `
  <section class="container" part="container" aria-label="Operation schemas">
    <div class="empty" part="empty" hidden></div>
    <div class="workspace" hidden>
      <section class="input-column" aria-label="Input schema">
        <div class="tool-rail input-rail" role="toolbar" aria-orientation="vertical" aria-label="Input schema tools">
          <button class="copy-input" part="copy-input" type="button" aria-label="Copy input schema as JSON" title="Copy input schema as JSON" disabled><span class="icon-copy">${ICON_COPY}</span><span class="icon-check">${ICON_CHECK}</span></button>
        </div>
        <pre class="schema-block input-schema" part="input-schema" hidden></pre>
        <p class="schema-empty input-empty" hidden>No input schema.</p>
      </section>
      <div class="layout-gutter" part="layout-gutter" role="separator" aria-orientation="vertical" aria-label="Resize input and output schemas" aria-valuemin="20" aria-valuemax="80" tabindex="0">
        <span class="layout-gutter-handle" aria-hidden="true"></span>
      </div>
      <section class="output-column" aria-label="Output schema">
        <pre class="schema-block output-schema" part="output-schema" hidden></pre>
        <p class="schema-empty output-empty" hidden>No output schema.</p>
        <div class="tool-rail output-rail" role="toolbar" aria-orientation="vertical" aria-label="Output schema tools">
          <button class="copy-output" part="copy-output" type="button" aria-label="Copy output schema as JSON" title="Copy output schema as JSON" disabled><span class="icon-copy">${ICON_COPY}</span><span class="icon-check">${ICON_CHECK}</span></button>
        </div>
      </section>
    </div>
  </section>
`;

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;
  }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: calc(var(--_ob-space) * 1.5);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  :host([flush]) .container {
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 0;
  }

  .workspace {
    display: grid;
    flex: 1 1 0;
    grid-template-columns:
      minmax(0, var(--_ob-split-input, 1fr))
      auto
      minmax(0, var(--_ob-split-output, 1fr));
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
  }

  .workspace[hidden] {
    display: none;
  }

  .input-column,
  .output-column {
    display: flex;
    gap: calc(var(--_ob-space) * 0.6);
    align-items: stretch;
    min-width: 0;
    min-height: 0;
  }

  :host([flush]) .input-column,
  :host([flush]) .output-column {
    gap: 0;
  }

  /* The reference block: code material, machine text, scrolls within. */
  .schema-block {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0.55rem;
    overflow: auto;
    color: var(--_ob-color-text);
    font: 0.76rem / 1.5 var(--_ob-font-mono);
    background: var(--_ob-code-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .schema-empty {
    display: grid;
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    padding: var(--_ob-space);
    place-items: center;
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
    background: var(--_ob-code-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  :host([flush]) .schema-block,
  :host([flush]) .schema-empty {
    border: 0;
    border-radius: 0;
  }

  .schema-block[hidden],
  .schema-empty[hidden] {
    display: none;
  }

  .empty {
    display: grid;
    min-height: 4rem;
    place-items: center;
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
  }

  button {
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .tool-rail button:not(:disabled):hover {
    color: var(--_ob-color-text);
  }

  /* One button, two glyphs: the check replaces the copy icon during the
     copied acknowledgement (same construction as the cockpit's copy). */
  .tool-rail button span {
    display: contents;
  }

  .tool-rail button .icon-check,
  .tool-rail button.copied .icon-copy {
    display: none;
  }

  .tool-rail button.copied {
    color: var(--_ob-color-success);
  }
`;

export interface SchemaSplitElement {
  addEventListener<K extends keyof SchemaSplitEventMap>(
    type: K,
    listener: (
      this: SchemaSplitElement,
      event: SchemaSplitEventMap[K],
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
    "ob-schema-split": SchemaSplitElement;
  }
}
