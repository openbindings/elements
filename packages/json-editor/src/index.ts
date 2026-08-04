import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
  setTextIfChanged,
} from "@openbindings/ui-core";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as editorPlaceholder,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
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

/**
 * A source editor for JSON and YAML with syntax highlighting, folding,
 * search, bracket matching, and a collapsible tree view.
 *
 * Source mode is CodeMirror 6 inside the shadow root (rev 14.2, review/60).
 * The hand-rolled textarea-plus-highlight overlay it replaces produced four
 * dogfooded defects (focus ring, collapse reset, caret displacement, scroll
 * drift) and a capability ceiling — folding had to be refused. CM6 is
 * framework-neutral, shadow-DOM-native, and is exactly what the panjir
 * benchmark editor was. It is an implementation detail: the element's
 * contract (properties in, `ob-json-input` out, tokens and parts for
 * styling) is unchanged.
 */
export class JSONEditorElement extends OpenBindingsElement {
  #text = "";
  #language: JSONEditorLanguage = "json";
  #view: JSONEditorView = "source";
  #readOnly = false;
  #placeholder = "";
  #label = "Document source";
  #errorLine: number | null = null;
  #tree: JSONTree | null = null;
  #treeDirty = true;
  #treeResetPending = true;
  #suppressInput = false;
  #editor: EditorView | null = null;
  readonly #languageConfig = new Compartment();
  readonly #readOnlyConfig = new Compartment();
  readonly #placeholderConfig = new Compartment();

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
    this.#editor?.focus();
  }

  protected override bind(refs: Refs): void {
    this.#editor = new EditorView({
      parent: refs.require(".cm-host"),
      root: this.shadowRoot as ShadowRoot,
      state: EditorState.create({
        doc: this.#text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          search(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          syntaxHighlighting(tokenColors),
          editorTheme,
          errorLineField,
          this.#languageConfig.of(this.#language === "yaml" ? yaml() : json()),
          this.#readOnlyConfig.of(EditorState.readOnly.of(this.#readOnly)),
          this.#placeholderConfig.of(
            this.#placeholder ? editorPlaceholder(this.#placeholder) : [],
          ),
          EditorView.updateListener.of(update => {
            if (!update.docChanged || this.#suppressInput) return;
            this.#text = update.state.doc.toString();
            this.#treeDirty = true;
            this.emit("ob-json-input", { text: this.#text, structured: false });
          }),
        ],
      }),
    });

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

    const editor = this.#editor;
    if (editor) {
      if (editor.state.doc.toString() !== this.#text) {
        // Only dispatch when it actually differs: a full replace resets the
        // selection and undo grouping.
        this.#suppressInput = true;
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: this.#text },
        });
        this.#suppressInput = false;
      }
      editor.dispatch({
        effects: [
          this.#languageConfig.reconfigure(
            this.#language === "yaml" ? yaml() : json(),
          ),
          this.#readOnlyConfig.reconfigure(
            EditorState.readOnly.of(this.#readOnly),
          ),
          this.#placeholderConfig.reconfigure(
            this.#placeholder ? editorPlaceholder(this.#placeholder) : [],
          ),
          setErrorLine.of(this.#errorLine),
        ],
      });
      editor.contentDOM.setAttribute("aria-label", this.#label);
    }

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

    if (!sourceActive && this.#treeDirty) this.#refreshTree();
  }

  #refs(): Refs | null {
    return this.shell(SHELL, baseStyles, styles);
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
    const editor = this.#editor;
    if (editor && editor.state.doc.toString() !== text) {
      this.#suppressInput = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
      });
      this.#suppressInput = false;
    }
    this.emit("ob-json-input", { text, structured });
  }

}

/** Marks one 1-based line as the parse-error line, cleared with null. */
const setErrorLine = StateEffect.define<number | null>();
const errorLineDecoration = Decoration.line({ class: "ob-error-line" });
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setErrorLine)) {
        if (effect.value === null) {
          value = Decoration.none;
        } else {
          const line = Math.max(
            1,
            Math.min(transaction.state.doc.lines, effect.value),
          );
          value = Decoration.set([
            errorLineDecoration.range(transaction.state.doc.line(line).from),
          ]);
        }
      }
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

/**
 * The element's theme tokens carried into CodeMirror: every color routes
 * through the same --_ob-* custom properties the rest of the element uses,
 * so app-level theming keeps working unchanged.
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--_ob-color-text)",
    backgroundColor: "transparent",
    fontSize: "var(--_ob-editor-font-size)",
  },
  ".cm-scroller": {
    fontFamily: "var(--_ob-font-mono)",
    lineHeight: "var(--_ob-editor-line-height)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "var(--_ob-editor-padding) 0",
    caretColor: "var(--_ob-color-text)",
  },
  ".cm-line": { padding: "0 var(--_ob-editor-padding)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--_ob-color-text)" },
  ".cm-gutters": {
    color: "var(--_ob-color-text-muted)",
    backgroundColor: "var(--_ob-color-surface)",
    border: "0",
    borderRight: "1px solid var(--_ob-color-border)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLine": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 6%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 10%, transparent)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 24%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 14%, transparent)",
  },
  ".ob-error-line": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-danger) 12%, transparent)",
  },
  ".cm-panels": {
    color: "var(--_ob-color-text)",
    backgroundColor: "var(--_ob-color-surface)",
    borderTop: "1px solid var(--_ob-color-border)",
  },
  ".cm-searchMatch": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 18%, transparent)",
  },
});

const tokenColors = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--_ob-editor-token-key)" },
  { tag: tags.string, color: "var(--_ob-editor-token-string)" },
  { tag: tags.number, color: "var(--_ob-editor-token-number)" },
  {
    tag: [tags.bool, tags.null, tags.keyword],
    color: "var(--_ob-editor-token-keyword)",
  },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket],
    color: "var(--_ob-editor-token-punct)",
  },
  { tag: tags.comment, color: "var(--_ob-editor-token-comment)" },
  { tag: tags.invalid, color: "var(--_ob-editor-token-invalid)" },
]);

const SHELL = `
  <div class="frame" part="frame">
    <div class="toolbar" part="toolbar">
      <div class="views" role="group" aria-label="Editor view">
        <button class="view-source" type="button" aria-pressed="true">Text</button>
        <button class="view-tree" type="button" aria-pressed="false">Tree</button>
      </div>
      <div class="tree-actions" hidden>
        <button class="expand-all subtle" type="button">Expand all</button>
        <button class="collapse-all subtle" type="button">Collapse all</button>
      </div>
    </div>
    <div class="source" part="source">
      <div class="cm-host" part="input"></div>
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
    display: block;
    min-height: 0;
    overflow: hidden;
  }

  .cm-host {
    height: 100%;
    min-height: 0;
  }

  .source[hidden],
  .tree-pane[hidden],
  .tree-actions[hidden] {
    display: none;
  }

  .frame:focus-within {
    border-color: color-mix(in srgb, var(--_ob-color-accent) 55%, var(--_ob-color-border));
    box-shadow: var(--_ob-focus-ring);
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

export type { JSONValue } from "./tree.js";
