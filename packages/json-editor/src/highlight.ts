import { jsonLanguage } from "@codemirror/lang-json";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { classHighlighter, highlightCode } from "@lezer/highlight";

/**
 * The design system's third tier of machine text (rev 17.5): the CODE BLOCK.
 *
 * - Code editor: CodeMirror, editable — text you author.
 * - Code view: CodeMirror, read-only — live values you inspect (folding,
 *   search, viewport-only rendering).
 * - Code block (this module): static, highlighted reference — schemas,
 *   examples, error details. No EditorView, no focus semantics, no tab
 *   stop, no per-render instance cost; just the same colors on the same
 *   material.
 *
 * This entry deliberately avoids importing the editor: consumers of
 * reference blocks pull only the lezer parsers and the class highlighter.
 */

export type CodeBlockLanguage = "json" | "yaml";

/**
 * Replaces `target`'s content with syntax-highlighted spans for `text`.
 * Built with DOM nodes (never innerHTML), so the text is inert by
 * construction. Tokens carry lezer's stable `tok-*` classes; adopt
 * CODE_BLOCK_STYLES in the consuming shadow root to color them with the
 * shared editor token variables.
 */
export function renderCodeBlock(
  target: HTMLElement,
  text: string,
  language: CodeBlockLanguage = "json",
): void {
  // Skip the parse when the text is unchanged — reference blocks re-render
  // whenever their host does, and the parse is the only real cost here.
  if (target.dataset.obCode === text && target.dataset.obLang === language) {
    return;
  }
  target.dataset.obCode = text;
  target.dataset.obLang = language;

  const parser = language === "yaml" ? yamlLanguage.parser : jsonLanguage.parser;
  const nodes: Node[] = [];
  highlightCode(
    text,
    parser.parse(text),
    classHighlighter,
    (code, classes) => {
      if (classes) {
        const span = document.createElement("span");
        span.className = classes;
        span.textContent = code;
        nodes.push(span);
      } else {
        nodes.push(document.createTextNode(code));
      }
    },
    () => {
      nodes.push(document.createTextNode("\n"));
    },
  );
  target.replaceChildren(...nodes);
}

/**
 * Colors for the `tok-*` classes, routed through the SAME token variables
 * the editor theme uses — one palette for all three tiers. The variables
 * resolve where the consuming element defines them; the fallbacks here
 * match the editor's defaults so a standalone consumer still highlights.
 */
export const CODE_BLOCK_STYLES = `
  .tok-propertyName {
    color: var(--_ob-editor-token-key, var(--ob-editor-token-key, #1a4fd6));
  }

  .tok-string, .tok-string2 {
    color: var(--_ob-editor-token-string, var(--ob-editor-token-string, #0b7a52));
  }

  .tok-number {
    color: var(--_ob-editor-token-number, var(--ob-editor-token-number, #9a5300));
  }

  .tok-bool, .tok-null, .tok-keyword, .tok-atom {
    color: var(--_ob-editor-token-keyword, var(--ob-editor-token-keyword, #8b21c9));
  }

  .tok-punctuation, .tok-separator, .tok-bracket, .tok-squareBracket,
  .tok-brace, .tok-paren {
    color: var(--_ob-editor-token-punct, var(--ob-editor-token-punct, inherit));
  }

  .tok-comment {
    color: var(--_ob-editor-token-comment, var(--ob-editor-token-comment, inherit));
  }

  .tok-invalid {
    color: var(--_ob-editor-token-invalid, var(--ob-editor-token-invalid, inherit));
  }
`;
