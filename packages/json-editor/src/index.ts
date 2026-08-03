import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
  debounce,
  setTextIfChanged,
} from "@openbindings/ui-core";
import { HIGHLIGHT_LIMIT, highlight, highlightWindow } from "./highlight.js";
import {
  JSONTree,
  type JSONValue,
  type TreeEditDetail,
  setAtPointer,
} from "./tree.js";

export const JSON_EDITOR_TAG = "ob-json-editor";

export type JSONEditorLanguage = "json" | "yaml";
export type JSONEditorView = "source" | "tree";

export interface JSONEditorInputDetail {
  text: string;
  /** True when the edit came from the tree view rather than a keystroke. */
  structured: boolean;
}

export interface JSONEditorViewDetail {
  view: JSONEditorView;
}

export interface JSONEditorEventMap {
  "ob-json-input": CustomEvent<JSONEditorInputDetail>;
  "ob-json-view": CustomEvent<JSONEditorViewDetail>;
}

/** Delay before the highlight layer catches up with the textarea. */
const HIGHLIGHT_DEBOUNCE_MS = 40;

/**
 * Documents longer than this colour only the visible window. Chosen so a
 * repaint stays inside a frame budget: whole-document tokenization runs at
 * roughly 1.5 ms per kilobyte, so 20 KB is about the largest document that
 * can be recoloured without a visible hitch.
 */
const WINDOW_THRESHOLD = 20_000;

/** Lines coloured above and below the viewport, to absorb small scrolls. */
const OVERSCAN_LINES = 40;

/**
 * A source editor for JSON and YAML with syntax highlighting, a line-number
 * gutter, structural indent handling, and a collapsible tree view.
 *
 * The editable surface is a real `<textarea>` with a highlighted layer behind
 * it. That keeps native selection, IME composition, undo history, spellcheck
 * suppression and accessibility semantics — none of which a
 * `contenteditable` re-implementation gets right — while still showing token
 * colour. The layer is `aria-hidden`, so assistive technology sees exactly one
 * editable control.
 *
 * Highlighting is debounced and the textarea is never re-rendered on input, so
 * the cost of a keystroke does not grow with document size; only the catch-up
 * pass does, and it is capped.
 */
export class JSONEditorElement extends OpenBindingsElement {
  #text = "";
  #language: JSONEditorLanguage = "json";
  #view: JSONEditorView = "source";
  #readOnly = false;
  #placeholder = "";
  #label = "Document source";
  #errorLine: number | null = null;
  #lineCount = -1;
  #markedErrorLine: number | null = null;
  #tree: JSONTree | null = null;
  #treeDirty = true;
  #treeResetPending = true;
  #suppressInput = false;
  #cachedLineHeight: number | null = null;

  readonly #scheduleHighlight = debounce(() => this.#paintHighlight(), HIGHLIGHT_DEBOUNCE_MS);

  get text(): string {
    return this.#text;
  }

  set text(value: string) {
    const next = value ?? "";
    if (next === this.#text) return;
    this.#text = next;
    this.#treeDirty = true;
    // A host-assigned document is a new editing context: the tree returns to
    // its depth default. View switches and the user's own edits keep the
    // user's collapse state (the set is pointer-keyed; stale pointers are
    // ignored).
    this.#treeResetPending = true;
    this.requestRender();
  }

  get language(): JSONEditorLanguage {
    return this.#language;
  }

  set language(value: JSONEditorLanguage) {
    const next = value === "yaml" ? "yaml" : "json";
    if (next === this.#language) return;
    this.#language = next;
    // The tree view can only represent JSON; fall back rather than lie.
    if (next === "yaml" && this.#view === "tree") this.#view = "source";
    this.requestRender();
  }

  get view(): JSONEditorView {
    return this.#view;
  }

  set view(value: JSONEditorView) {
    const next = value === "tree" && this.#language === "json" ? "tree" : "source";
    if (next === this.#view) return;
    this.#view = next;
    this.#treeDirty = true;
    this.requestRender();
    this.emit("ob-json-view", { view: next });
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  set readOnly(value: boolean) {
    const next = Boolean(value);
    if (next === this.#readOnly) return;
    this.#readOnly = next;
    this.requestRender();
  }

  get placeholder(): string {
    return this.#placeholder;
  }

  set placeholder(value: string) {
    const next = value ?? "";
    if (next === this.#placeholder) return;
    this.#placeholder = next;
    this.requestRender();
  }

  get label(): string {
    return this.#label;
  }

  set label(value: string) {
    const next = value?.trim() || "Document source";
    if (next === this.#label) return;
    this.#label = next;
    this.requestRender();
  }

  /** 1-based line to mark as the error location, or null to clear. */
  get errorLine(): number | null {
    return this.#errorLine;
  }

  set errorLine(value: number | null) {
    const next = typeof value === "number" && value > 0 ? Math.floor(value) : null;
    if (next === this.#errorLine) return;
    this.#errorLine = next;
    this.requestRender();
  }

  /** Reformats the document with two-space indentation. */
  format(): boolean {
    if (this.#readOnly || this.#language !== "json") return false;
    try {
      const parsed = JSON.parse(this.#text) as JSONValue;
      this.#applyText(`${JSON.stringify(parsed, null, 2)}\n`, true);
      return true;
    } catch {
      return false;
    }
  }

  expandAll(): void {
    this.#tree?.expandAll();
  }

  collapseAll(): void {
    this.#tree?.collapseAll();
  }

  focusEditor(): void {
    this.#refs()?.find<HTMLTextAreaElement>("textarea")?.focus();
  }

  protected override bind(refs: Refs): void {
    const textarea = refs.require<HTMLTextAreaElement>("textarea");
    const layer = refs.require(".highlight");

    textarea.addEventListener("input", () => {
      if (this.#suppressInput) return;
      this.#text = textarea.value;
      this.#treeDirty = true;
      this.#syncGutter();
      this.#scheduleHighlight();
      this.emit("ob-json-input", { text: this.#text, structured: false });
    });

    textarea.addEventListener("scroll", () => {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
      const gutter = refs.find(".gutter");
      if (gutter) gutter.scrollTop = textarea.scrollTop;
      // A windowed document must re-colour the newly exposed lines.
      if (this.#text.length > WINDOW_THRESHOLD) this.#scheduleHighlight();
    });

    textarea.addEventListener("keydown", event => this.#handleKeydown(event, textarea));

    refs.require(".view-source").addEventListener("click", () => {
      this.view = "source";
    });
    refs.require(".view-tree").addEventListener("click", () => {
      this.view = "tree";
    });
    refs.require(".expand-all").addEventListener("click", () => this.expandAll());
    refs.require(".collapse-all").addEventListener("click", () => this.collapseAll());

    this.#tree = new JSONTree(refs.require(".tree"), {
      onEdit: detail => this.#applyTreeEdit(detail),
      readOnly: this.#readOnly,
    });
  }

  protected override render(): void {
    const refs = this.#refs();
    if (!refs) return;

    const textarea = refs.require<HTMLTextAreaElement>("textarea");
    if (textarea.value !== this.#text) {
      // Only assign when it actually differs: assigning resets the caret.
      this.#suppressInput = true;
      textarea.value = this.#text;
      this.#suppressInput = false;
    }
    textarea.readOnly = this.#readOnly;
    textarea.placeholder = this.#placeholder;
    textarea.setAttribute("aria-label", this.#label);

    const sourceActive = this.#view === "source";
    refs.require(".source").hidden = !sourceActive;
    refs.require(".tree-pane").hidden = sourceActive;
    refs.require(".tree-actions").hidden = sourceActive;

    const sourceButton = refs.require<HTMLButtonElement>(".view-source");
    const treeButton = refs.require<HTMLButtonElement>(".view-tree");
    sourceButton.setAttribute("aria-pressed", String(sourceActive));
    treeButton.setAttribute("aria-pressed", String(!sourceActive));
    treeButton.disabled = this.#language !== "json";
    treeButton.title =
      this.#language === "json" ? "Tree view" : "Tree view is available for JSON";

    this.#syncGutter();
    this.#paintHighlight();

    if (!sourceActive && this.#treeDirty) this.#refreshTree();
  }

  #refs(): Refs | null {
    return this.shell(SHELL, baseStyles, styles);
  }

  #paintHighlight(): void {
    const refs = this.#refs();
    if (!refs || this.#view !== "source") return;
    const layer = refs.require(".highlight");
    const textarea = refs.require<HTMLTextAreaElement>("textarea");

    // Below the windowing threshold the whole document is cheap to tokenize,
    // and doing so avoids any boundary artefacts.
    if (this.#text.length <= WINDOW_THRESHOLD) {
      layer.innerHTML = highlight(this.#text, this.#language);
    } else {
      const lineHeight = this.#lineHeight(textarea);
      const first = Math.floor(textarea.scrollTop / lineHeight) - OVERSCAN_LINES;
      const visible = Math.ceil(textarea.clientHeight / lineHeight);
      layer.innerHTML = highlightWindow(
        this.#text,
        this.#language,
        Math.max(1, first),
        Math.max(1, first) + visible + OVERSCAN_LINES * 2,
      );
    }
    layer.classList.toggle("plain", this.#text.length > HIGHLIGHT_LIMIT);
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  }

  /** Cached line box height; the metric never changes for a given element. */
  #lineHeight(textarea: HTMLTextAreaElement): number {
    if (this.#cachedLineHeight === null) {
      const parsed = Number.parseFloat(
        getComputedStyle(textarea).lineHeight || "",
      );
      this.#cachedLineHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
    }
    return this.#cachedLineHeight;
  }

  #syncGutter(): void {
    const refs = this.#refs();
    if (!refs) return;
    const gutter = refs.require(".gutter");
    const lines = countLines(this.#text);
    if (lines !== this.#lineCount) {
      this.#lineCount = lines;
      const fragment = document.createDocumentFragment();
      for (let line = 1; line <= lines; line += 1) {
        const cell = document.createElement("span");
        cell.textContent = String(line);
        cell.dataset.line = String(line);
        fragment.append(cell);
      }
      gutter.replaceChildren(fragment);
      this.#markedErrorLine = null;
    }
    // Touch only the two cells that can change, rather than walking every
    // line on every keystroke — that walk is O(document length) and was the
    // dominant per-keystroke cost in large documents.
    if (this.#markedErrorLine !== this.#errorLine) {
      if (this.#markedErrorLine !== null) {
        gutter.children[this.#markedErrorLine - 1]?.classList.remove("error");
      }
      if (this.#errorLine !== null) {
        gutter.children[this.#errorLine - 1]?.classList.add("error");
      }
      this.#markedErrorLine = this.#errorLine;
    }
  }

  #refreshTree(): void {
    const refs = this.#refs();
    if (!refs || !this.#tree) return;
    this.#tree.options = {
      onEdit: detail => this.#applyTreeEdit(detail),
      readOnly: this.#readOnly,
    };
    let parsed: JSONValue | undefined;
    try {
      parsed = this.#text.trim() ? (JSON.parse(this.#text) as JSONValue) : undefined;
    } catch {
      parsed = undefined;
    }
    this.#tree.setValue(parsed, { reset: this.#treeResetPending });
    this.#treeResetPending = false;
    this.#treeDirty = false;
    setTextIfChanged(
      refs.require(".tree-status"),
      parsed === undefined ? "Switch to Source to fix the document." : "",
    );
  }

  #applyTreeEdit(detail: TreeEditDetail): void {
    let parsed: JSONValue;
    try {
      parsed = JSON.parse(this.#text) as JSONValue;
    } catch {
      return;
    }
    const next = setAtPointer(parsed, detail.pointer, detail.value);
    this.#applyText(`${JSON.stringify(next, null, 2)}\n`, true);
  }

  #applyText(text: string, structured: boolean): void {
    this.#text = text;
    this.#treeDirty = !structured;
    const refs = this.#refs();
    const textarea = refs?.find<HTMLTextAreaElement>("textarea");
    if (textarea && textarea.value !== text) {
      this.#suppressInput = true;
      textarea.value = text;
      this.#suppressInput = false;
    }
    this.#syncGutter();
    this.#paintHighlight();
    this.emit("ob-json-input", { text, structured });
  }

  /**
   * Structural editing affordances the textarea does not provide: block
   * indent and outdent, indent-preserving newlines that open a block, and
   * bracket completion that does not fight an existing selection.
   */
  #handleKeydown(event: KeyboardEvent, textarea: HTMLTextAreaElement): void {
    if (this.#readOnly) return;

    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart, selectionEnd } = textarea;
      if (selectionStart !== selectionEnd || event.shiftKey) {
        this.#indentSelection(textarea, event.shiftKey);
      } else {
        textarea.setRangeText("  ", selectionStart, selectionEnd, "end");
      }
      this.#commitFromTextarea(textarea);
      return;
    }

    if (event.key === "Enter") {
      const { selectionStart } = textarea;
      const lineStart = textarea.value.lastIndexOf("\n", selectionStart - 1) + 1;
      const line = textarea.value.slice(lineStart, selectionStart);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      const opens = /[{[]\s*$/.test(line);
      const nextChar = textarea.value[selectionStart] ?? "";
      const closes = opens && (nextChar === "}" || nextChar === "]");
      if (!indent && !opens) return;
      event.preventDefault();
      const inner = opens ? `${indent}  ` : indent;
      const insertion = closes ? `\n${inner}\n${indent}` : `\n${inner}`;
      textarea.setRangeText(insertion, selectionStart, textarea.selectionEnd, "end");
      if (closes) {
        const caret = selectionStart + 1 + inner.length;
        textarea.setSelectionRange(caret, caret);
      }
      this.#commitFromTextarea(textarea);
      return;
    }

    const pair = PAIRS[event.key];
    if (pair) {
      const { selectionStart, selectionEnd } = textarea;
      if (selectionStart === selectionEnd) {
        const nextChar = textarea.value[selectionStart] ?? "";
        // Only auto-close at a boundary, never mid-token.
        if (nextChar && !/[\s,\]}]/.test(nextChar)) return;
        event.preventDefault();
        textarea.setRangeText(event.key + pair, selectionStart, selectionEnd, "end");
        textarea.setSelectionRange(selectionStart + 1, selectionStart + 1);
      } else {
        event.preventDefault();
        const selected = textarea.value.slice(selectionStart, selectionEnd);
        textarea.setRangeText(
          event.key + selected + pair,
          selectionStart,
          selectionEnd,
          "end",
        );
        textarea.setSelectionRange(selectionStart + 1, selectionEnd + 1);
      }
      this.#commitFromTextarea(textarea);
    }
  }

  #indentSelection(textarea: HTMLTextAreaElement, outdent: boolean): void {
    const value = textarea.value;
    const start = value.lastIndexOf("\n", textarea.selectionStart - 1) + 1;
    const rawEnd = value.indexOf("\n", textarea.selectionEnd);
    const end = rawEnd === -1 ? value.length : rawEnd;
    const block = value.slice(start, end);
    const shifted = block
      .split("\n")
      .map(line =>
        outdent ? line.replace(/^ {1,2}/, "") : line.trim() ? `  ${line}` : line,
      )
      .join("\n");
    textarea.setRangeText(shifted, start, end, "preserve");
    textarea.setSelectionRange(start, start + shifted.length);
  }

  #commitFromTextarea(textarea: HTMLTextAreaElement): void {
    this.#text = textarea.value;
    this.#treeDirty = true;
    this.#syncGutter();
    this.#scheduleHighlight();
    this.emit("ob-json-input", { text: this.#text, structured: false });
  }
}

const PAIRS: Record<string, string> = { "{": "}", "[": "]", '"': '"' };

function countLines(text: string): number {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") lines += 1;
  }
  return lines;
}

const SHELL = `
  <div class="frame" part="frame">
    <div class="toolbar" part="toolbar">
      <div class="views" role="group" aria-label="Editor view">
        <button class="view-source" type="button" aria-pressed="true">Source</button>
        <button class="view-tree" type="button" aria-pressed="false">Tree</button>
      </div>
      <div class="tree-actions" hidden>
        <button class="expand-all subtle" type="button">Expand all</button>
        <button class="collapse-all subtle" type="button">Collapse all</button>
      </div>
    </div>
    <div class="source" part="source">
      <div class="gutter" part="gutter" aria-hidden="true"></div>
      <div class="surface">
        <pre class="highlight" aria-hidden="true"></pre>
        <textarea
          part="input"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          wrap="off"
        ></textarea>
      </div>
    </div>
    <div class="tree-pane" part="tree" hidden>
      <p class="tree-status" role="status"></p>
      <div class="tree"></div>
    </div>
  </div>
`;

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;

    --_ob-editor-font-size: var(--ob-editor-font-size, 0.78rem);
    --_ob-editor-line-height: var(--ob-editor-line-height, 1.55);
    --_ob-editor-padding: var(--ob-editor-padding, 0.6rem);
    --_ob-editor-token-key: var(--ob-editor-token-key, #1a4fd6);
    --_ob-editor-token-string: var(--ob-editor-token-string, #0b7a52);
    --_ob-editor-token-number: var(--ob-editor-token-number, #9a5300);
    --_ob-editor-token-keyword: var(--ob-editor-token-keyword, #8b21c9);
    --_ob-editor-token-punct: var(--ob-editor-token-punct, var(--_ob-color-text-muted));
    --_ob-editor-token-comment: var(--ob-editor-token-comment, var(--_ob-color-text-muted));
    --_ob-editor-token-invalid: var(--ob-editor-token-invalid, var(--_ob-color-danger));
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --_ob-editor-token-key: var(--ob-editor-token-key, #8fb4ff);
      --_ob-editor-token-string: var(--ob-editor-token-string, #6bd6a4);
      --_ob-editor-token-number: var(--ob-editor-token-number, #f0b45f);
      --_ob-editor-token-keyword: var(--ob-editor-token-keyword, #d3a2ff);
    }
  }

  .frame {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
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
    padding: 0.35rem 0.5rem;
    background: var(--_ob-color-surface);
    border-bottom: 1px solid var(--_ob-color-border);
  }

  .views {
    display: flex;
    gap: 0.15rem;
    padding: 0.12rem;
    background: var(--_ob-color-surface-strong);
    border-radius: calc(var(--_ob-radius) * 0.7);
  }

  .views button {
    min-height: 1.7rem;
    padding: 0 0.7rem;
    background: transparent;
    border: 0;
    border-radius: calc(var(--_ob-radius) * 0.55);
    cursor: pointer;
  }

  .views button[aria-pressed="true"] {
    background: var(--_ob-color-background);
    box-shadow: var(--_ob-shadow);
  }

  .views button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .tree-actions {
    display: flex;
    gap: 0.3rem;
  }

  .subtle {
    min-height: 1.7rem;
    padding: 0 0.55rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: calc(var(--_ob-radius) * 0.55);
    color: var(--_ob-color-text-muted);
    cursor: pointer;
  }

  .subtle:hover {
    background: var(--_ob-color-surface-strong);
    color: var(--_ob-color-text);
  }

  .source {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .source[hidden],
  .tree-pane[hidden],
  .tree-actions[hidden] {
    display: none;
  }

  .gutter {
    display: flex;
    flex-direction: column;
    padding: var(--_ob-editor-padding) 0.5rem var(--_ob-editor-padding) 0.6rem;
    overflow: hidden;
    color: var(--_ob-color-text-muted);
    text-align: right;
    background: var(--_ob-color-surface);
    border-right: 1px solid var(--_ob-color-border);
    font-family: var(--_ob-font-mono);
    font-size: var(--_ob-editor-font-size);
    line-height: var(--_ob-editor-line-height);
    font-variant-numeric: tabular-nums;
    user-select: none;
  }

  .gutter span.error {
    color: var(--_ob-color-accent-contrast);
    background: var(--_ob-color-danger);
    border-radius: 0.2rem;
  }

  .frame {
    /*
     * Inherited-white-space immunity: with white-space: pre arriving from a
     * host or wrapper, the shell template's own whitespace text nodes become
     * LAYOUT — two newlines and eight spaces displaced the transparent
     * textarea (8ch, 2 line-heights) from the highlight layer, and every
     * click placed the caret two lines from where the user aimed. Reset at
     * the boundary; internal rules re-declare pre exactly where glyphs need
     * it.
     */
    white-space: normal;
  }

  .surface {
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  /*
   * The highlight layer and the textarea must agree on every metric that
   * affects glyph position, or the colours drift away from the characters.
   */
  .highlight,
  .surface textarea {
    margin: 0;
    padding: var(--_ob-editor-padding);
    border: 0;
    font-family: var(--_ob-font-mono);
    font-size: var(--_ob-editor-font-size);
    line-height: var(--_ob-editor-line-height);
    letter-spacing: normal;
    tab-size: 2;
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
  }

  .highlight {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--_ob-color-text);
    pointer-events: none;
  }

  .surface textarea {
    /* Block, not inline-block: an inline box participates in whatever text
       flow surrounds it, so stray text nodes could offset it. A block box
       starts at the content origin no matter what. */
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    color: transparent;
    background: transparent;
    caret-color: var(--_ob-color-text);
    resize: none;
    outline: 0;
  }

  .surface textarea::selection {
    background: color-mix(in srgb, var(--_ob-color-accent) 26%, transparent);
  }

  /* The textarea is a transparent overlay inset past the gutter and sized to
     the content, not the perceived control — a ring on it draws a floating
     box mid-editor (worst in dark themes, where the accent is light). Focus
     presentation is delegated to the frame instead. */
  .surface textarea,
  .surface textarea:focus-visible {
    outline: none;
    box-shadow: none;
  }

  .frame:focus-within {
    border-color: color-mix(in srgb, var(--_ob-color-accent) 55%, var(--_ob-color-border));
    box-shadow: var(--_ob-focus-ring);
  }

  .highlight.plain {
    color: var(--_ob-color-text);
  }

  .t-key { color: var(--_ob-editor-token-key); }
  .t-string { color: var(--_ob-editor-token-string); }
  .t-number { color: var(--_ob-editor-token-number); }
  .t-keyword { color: var(--_ob-editor-token-keyword); font-weight: 600; }
  .t-punct { color: var(--_ob-editor-token-punct); }
  .t-comment { color: var(--_ob-editor-token-comment); font-style: italic; }
  .t-invalid {
    color: var(--_ob-editor-token-invalid);
    text-decoration: underline wavy currentColor;
    text-underline-offset: 0.18em;
  }

  .tree-pane {
    min-height: 0;
    padding: 0.35rem 0;
    overflow: auto;
    font-family: var(--_ob-font-mono);
    font-size: var(--_ob-editor-font-size);
    line-height: 1.7;
  }

  .tree-status:empty {
    display: none;
  }

  .tree-status {
    margin: 0.2rem 0.6rem 0.5rem;
    color: var(--_ob-color-danger);
  }

  .tree-empty {
    margin: 0.4rem 0.75rem;
    color: var(--_ob-color-text-muted);
  }

  .tree-row,
  .tree-more {
    display: flex;
    gap: 0.05rem;
    align-items: baseline;
    padding-inline-start: calc(0.5rem + var(--depth, 0) * 0.95rem);
    white-space: pre;
  }

  .tree-row:hover {
    background: var(--_ob-color-surface);
  }

  .twisty,
  .twisty-spacer {
    width: 1.05rem;
    flex: 0 0 auto;
    padding: 0;
    color: var(--_ob-color-text-muted);
    text-align: left;
    background: transparent;
    border: 0;
  }

  .twisty {
    cursor: pointer;
  }

  .twisty:hover {
    color: var(--_ob-color-text);
  }

  .tree-key {
    color: var(--_ob-editor-token-key);
  }

  .tree-summary {
    color: var(--_ob-color-text-muted);
  }

  .tree-value {
    border-radius: 0.2rem;
  }

  .tree-value[role="button"] {
    cursor: text;
  }

  .tree-value[role="button"]:hover {
    box-shadow: inset 0 0 0 1px var(--_ob-color-border);
  }

  .tree-value.is-string { color: var(--_ob-editor-token-string); }
  .tree-value.is-number { color: var(--_ob-editor-token-number); }
  .tree-value.is-boolean,
  .tree-value.is-null { color: var(--_ob-editor-token-keyword); }

  .tree-edit {
    min-width: 6rem;
    padding: 0 0.2rem;
    color: var(--_ob-color-text);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-accent);
    border-radius: 0.2rem;
    font: inherit;
  }

  .tree-more {
    margin-top: 0.15rem;
    color: var(--_ob-color-accent);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
`;

export interface JSONEditorElement {
  addEventListener<K extends keyof JSONEditorEventMap>(
    type: K,
    listener: (this: JSONEditorElement, event: JSONEditorEventMap[K]) => void,
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
    "ob-json-editor": JSONEditorElement;
  }
}

export { HIGHLIGHT_LIMIT, highlight } from "./highlight.js";
export type { JSONValue } from "./tree.js";
