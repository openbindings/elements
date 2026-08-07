import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
} from "@openbindings/ui-core";
import { locatePath, type LocateLanguage } from "./locate.js";
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

export const JSON_EDITOR_TAG = "ob-json-editor";

export type JSONEditorLanguage = "json" | "yaml";

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface JSONEditorInputDetail {
  text: string;
  /** True when the edit came from a structural action (e.g. format()). */
  structured: boolean;
}

export interface JSONEditorEventMap {
  "ob-json-input": CustomEvent<JSONEditorInputDetail>;
}

/**
 * A source editor for JSON and YAML with syntax highlighting, folding,
 * search, and bracket matching.
 *
 * The surface is CodeMirror 6 inside the shadow root (rev 14.2, review/60).
 * The hand-rolled textarea-plus-highlight overlay it replaces produced four
 * dogfooded defects (focus ring, collapse reset, caret displacement, scroll
 * drift) and a capability ceiling — folding had to be refused. CM6 is
 * framework-neutral, shadow-DOM-native, and is exactly what the panjir
 * benchmark editor was. It is an implementation detail: the element's
 * contract (properties in, `ob-json-input` out, tokens and parts for
 * styling) is unchanged.
 *
 * Rev 15 removed the separate tree view: CM6 folding already provides the
 * collapse/inspect affordance the tree existed for, without a mode switch.
 */
export class JSONEditorElement extends OpenBindingsElement {
  #text = "";
  #language: JSONEditorLanguage = "json";
  #readOnly = false;
  #placeholder = "";
  #label = "Document source";
  #errorLine: number | null = null;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.requestRender();
  }

  get language(): JSONEditorLanguage {
    return this.#language;
  }

  set language(value: JSONEditorLanguage) {
    const next = value === "yaml" ? "yaml" : "json";
    if (next === this.#language) return;
    this.#language = next;
    this.requestRender();
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

  /**
   * Scrolls the located document path into view and flashes it (rev 17.14).
   * Returns whether the path was found in the CURRENT buffer — a draft that
   * does not parse simply reports false; the invalid chip already explains
   * why, so there is nothing to announce here.
   *
   * Deliberately gentle: focus and caret are never touched (17.10.1), and
   * a target already on screen does not scroll at all — clicking through
   * neighbouring operations moves nothing.
   */
  revealPath(path: ReadonlyArray<string | number>): boolean {
    const view = this.#editor;
    if (!view) return false;
    const range = locatePath(
      view.state,
      path,
      this.#language as LocateLanguage,
    );
    if (!range) return false;

    view.dispatch({ effects: [setFlashRange.of(range)] });
    if (!this.#isVisible(range.from, range.to)) this.#scrollTo(range.from);

    if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.#flashTimer = null;
      this.#editor?.dispatch({ effects: setFlashRange.of(null) });
    }, FLASH_MS);
    return true;
  }

  /**
   * Centres a position by scrolling THIS editor's scroller and nothing else.
   *
   * CodeMirror's own scrollIntoView effect walks up the DOM and scrolls every
   * ancestor scroll container it finds. `overflow: hidden` suppresses a
   * scrollbar but NOT programmatic scrolling, so in an app whose frame is a
   * full-viewport hidden-overflow layout that walk shoves the entire
   * application off-screen with no scrollbar to bring it back (dogfood, rev
   * 17.14.1). Reveal is a local act: it moves one scroller.
   */
  #scrollTo(position: number): void {
    const view = this.#editor;
    if (!view) return;
    const scroller = view.scrollDOM;
    const block = view.lineBlockAt(Math.min(position, view.state.doc.length));
    const centred = block.top - (scroller.clientHeight - block.height) / 2;
    const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(centred, maximum));
  }

  /** Whether the range's start line is already inside the visible viewport. */
  #isVisible(from: number, to: number): boolean {
    const view = this.#editor;
    if (!view) return false;
    const scroller = view.scrollDOM;
    const top = view.lineBlockAt(Math.min(from, view.state.doc.length)).top;
    const bottom = view.lineBlockAt(Math.min(to, view.state.doc.length)).bottom;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    // The START must be visible; a node taller than the viewport still
    // counts as revealed once its head is on screen.
    return top >= viewTop && Math.min(bottom, top + 1) <= viewBottom;
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
          // The system disclosure chevron (ui-core construction): CM's fold
          // markers draw the same border-chevron every other collapse
          // affordance uses — closed points right, open points down.
          foldGutter({
            markerDOM: open => {
              const marker = document.createElement("span");
              marker.className = `ob-fold-marker${open ? " open" : ""}`;
              marker.setAttribute("aria-hidden", "true");
              return marker;
            },
          }),
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
          flashField,
          this.#languageConfig.of(this.#language === "yaml" ? yaml() : json()),
          this.#readOnlyConfig.of(EditorState.readOnly.of(this.#readOnly)),
          this.#placeholderConfig.of(
            this.#placeholder ? editorPlaceholder(this.#placeholder) : [],
          ),
          EditorView.updateListener.of(update => {
            if (!update.docChanged || this.#suppressInput) return;
            this.#text = update.state.doc.toString();
            this.emit("ob-json-input", { text: this.#text, structured: false });
          }),
        ],
      }),
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
  }

  #refs(): Refs | null {
    return this.shell(SHELL, baseStyles, styles);
  }

  #applyText(text: string, structured: boolean): void {
    this.#text = text;
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

/** How long a reveal flash lingers before it decays away. */
const FLASH_MS = 1200;

/**
 * A reveal flash (rev 17.14): a decaying highlight over a located range.
 * Deliberately NOT a selection — selection would move the caret, and the
 * caret belongs to whoever is typing (17.10.1).
 */
const setFlashRange = StateEffect.define<{ from: number; to: number } | null>();
const flashDecoration = Decoration.mark({ class: "ob-reveal-flash" });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setFlashRange)) {
        value =
          effect.value === null || effect.value.from >= effect.value.to
            ? Decoration.none
            : Decoration.set([
                flashDecoration.range(
                  Math.max(0, effect.value.from),
                  Math.min(transaction.state.doc.length, effect.value.to),
                ),
              ]);
      }
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

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
    backgroundColor: "var(--_ob-code-surface)",
    fontSize: "var(--_ob-editor-font-size)",
  },
  ".cm-scroller": {
    fontFamily: "var(--_ob-font-mono)",
    lineHeight: "var(--_ob-editor-line-height)",
    overflow: "auto",
  },
  /* The reveal flash (rev 17.14): a soft accent wash that decays away.
     Never a selection — the caret stays wherever the user left it. */
  ".ob-reveal-flash": {
    backgroundColor:
      "color-mix(in srgb, var(--_ob-color-accent) 22%, transparent)",
    borderRadius: "2px",
    transition: "background-color var(--_ob-duration, 160ms) ease",
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
    backgroundColor: "var(--_ob-code-surface)",
    border: "0",
    borderRight: "1px solid var(--_ob-color-border)",
    fontVariantNumeric: "tabular-nums",
  },
  // The system disclosure chevron (ui-core construction) for fold markers.
  ".cm-foldGutter .ob-fold-marker": {
    display: "inline-block",
    width: "0.34em",
    height: "0.34em",
    margin: "0 0.2em",
    borderRight: "1.5px solid currentColor",
    borderBottom: "1.5px solid currentColor",
    transform: "rotate(-45deg)",
    transition: "transform var(--_ob-duration) ease",
  },
  ".cm-foldGutter .ob-fold-marker.open": {
    transform: "rotate(45deg)",
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
  {
    tag: tags.invalid,
    color: "var(--_ob-editor-token-invalid)",
    textDecoration: "underline wavy",
  },
]);

const SHELL = `
  <div class="frame" part="frame">
    <div class="source" part="source">
      <div class="cm-host" part="input"></div>
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
  }

  .frame {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
    /* Hosts have leaked inheritable white-space (pre) into this shadow tree
       before; the frame resets it so template whitespace never becomes
       layout. */
    white-space: normal;
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

  .frame:focus-within {
    border-color: color-mix(in srgb, var(--_ob-color-accent) 55%, var(--_ob-color-border));
    box-shadow: var(--_ob-focus-ring);
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
