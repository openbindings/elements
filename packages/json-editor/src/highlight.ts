/**
 * Dependency-free tokenizers for the editor's highlight layer.
 *
 * These are deliberately tolerant: the text being highlighted is mid-edit and
 * usually not valid, so a tokenizer that throws or resynchronises badly would
 * make the editor flicker exactly when the author most needs to see structure.
 * Every scanner therefore always consumes at least one character and emits
 * unrecognised runs as `plain`.
 */

export type TokenKind =
  | "plain"
  | "key"
  | "string"
  | "number"
  | "keyword"
  | "punct"
  | "comment"
  | "invalid";

export interface Token {
  kind: TokenKind;
  text: string;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/** Longest document that is highlighted; beyond this the editor stays plain. */
export const HIGHLIGHT_LIMIT = 400_000;

export function tokenizeJSON(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const push = (kind: TokenKind, text: string): void => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };

  while (index < source.length) {
    const char = source[index]!;

    if (WHITESPACE.has(char)) {
      let end = index;
      while (end < source.length && WHITESPACE.has(source[end]!)) end += 1;
      push("plain", source.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"') {
      const { text, end, terminated } = scanString(source, index);
      // A string is a key when the next significant character is a colon.
      const kind = terminated && nextSignificant(source, end) === ":"
        ? "key"
        : terminated
          ? "string"
          : "invalid";
      push(kind, text);
      index = end;
      continue;
    }

    if (char === "-" || (char >= "0" && char <= "9")) {
      const end = scanNumber(source, index);
      push("number", source.slice(index, end));
      index = end;
      continue;
    }

    if (isWordStart(char)) {
      let end = index;
      while (end < source.length && isWordChar(source[end]!)) end += 1;
      const word = source.slice(index, end);
      push(
        word === "true" || word === "false" || word === "null"
          ? "keyword"
          : "invalid",
        word,
      );
      index = end;
      continue;
    }

    if ("{}[]:,".includes(char)) {
      push("punct", char);
      index += 1;
      continue;
    }

    push("invalid", char);
    index += 1;
  }

  return tokens;
}

/**
 * A pragmatic YAML scanner. It highlights the constructs an OBI document
 * actually uses — mapping keys, scalars, sequences, comments, anchors — and
 * degrades to `plain` elsewhere rather than pretending to implement YAML.
 */
export function tokenizeYAML(source: string): Token[] {
  const tokens: Token[] = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine;
    const indentLength = line.length - line.trimStart().length;
    const indent = line.slice(0, indentLength);
    let rest = line.slice(indentLength);

    if (indent) tokens.push({ kind: "plain", text: indent });

    if (rest.startsWith("#")) {
      tokens.push({ kind: "comment", text: rest });
      tokens.push({ kind: "plain", text: "\n" });
      continue;
    }

    if (rest.startsWith("- ") || rest === "-") {
      tokens.push({ kind: "punct", text: "-" });
      rest = rest.slice(1);
      if (rest.startsWith(" ")) {
        tokens.push({ kind: "plain", text: " " });
        rest = rest.slice(1);
      }
    }

    if (rest.startsWith("---") || rest.startsWith("...")) {
      tokens.push({ kind: "punct", text: rest });
      tokens.push({ kind: "plain", text: "\n" });
      continue;
    }

    const keyMatch = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#]+?)(\s*:)(\s|$)/.exec(
      rest,
    );
    if (keyMatch) {
      tokens.push({ kind: "key", text: keyMatch[1]! });
      tokens.push({ kind: "punct", text: keyMatch[2]! });
      const consumed = keyMatch[1]!.length + keyMatch[2]!.length;
      rest = rest.slice(consumed);
    }

    if (rest) tokens.push(...yamlScalar(rest));
    tokens.push({ kind: "plain", text: "\n" });
  }

  // split("\n") produces a trailing empty element for a trailing newline;
  // the loop already emitted its "\n", so drop the duplicate.
  if (tokens[tokens.length - 1]?.text === "\n") tokens.pop();
  return tokens;
}

function yamlScalar(text: string): Token[] {
  const commentIndex = findYAMLComment(text);
  const value = commentIndex < 0 ? text : text.slice(0, commentIndex);
  const comment = commentIndex < 0 ? "" : text.slice(commentIndex);
  const tokens: Token[] = [];
  const trimmed = value.trim();

  if (!trimmed) {
    if (value) tokens.push({ kind: "plain", text: value });
  } else {
    const leading = value.slice(0, value.length - value.trimStart().length);
    const trailing = value.slice(value.trimEnd().length);
    if (leading) tokens.push({ kind: "plain", text: leading });
    tokens.push({ kind: yamlScalarKind(trimmed), text: trimmed });
    if (trailing) tokens.push({ kind: "plain", text: trailing });
  }

  if (comment) tokens.push({ kind: "comment", text: comment });
  return tokens;
}

function yamlScalarKind(value: string): TokenKind {
  if (/^(true|false|null|yes|no|~)$/i.test(value)) return "keyword";
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return "number";
  if (value.startsWith('"') || value.startsWith("'")) return "string";
  if (value.startsWith("&") || value.startsWith("*")) return "keyword";
  if (value === "|" || value === ">" || value === "|-" || value === ">-") {
    return "punct";
  }
  return "string";
}

function findYAMLComment(text: string): number {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || text[index - 1] === " ")) return index;
  }
  return -1;
}

function scanString(
  source: string,
  start: number,
): { text: string; end: number; terminated: boolean } {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') {
      return { text: source.slice(start, index + 1), end: index + 1, terminated: true };
    }
    // An unterminated string must not swallow the rest of the document.
    if (char === "\n") break;
    index += 1;
  }
  return { text: source.slice(start, index), end: index, terminated: false };
}

function scanNumber(source: string, start: number): number {
  let index = start;
  if (source[index] === "-") index += 1;
  while (index < source.length && isDigit(source[index]!)) index += 1;
  if (source[index] === ".") {
    index += 1;
    while (index < source.length && isDigit(source[index]!)) index += 1;
  }
  if (source[index] === "e" || source[index] === "E") {
    index += 1;
    if (source[index] === "+" || source[index] === "-") index += 1;
    while (index < source.length && isDigit(source[index]!)) index += 1;
  }
  return Math.max(index, start + 1);
}

function nextSignificant(source: string, from: number): string | null {
  let index = from;
  while (index < source.length && WHITESPACE.has(source[index]!)) index += 1;
  return source[index] ?? null;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isWordStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeHTML(value: string): string {
  return value.replace(/[&<>]/g, char => ESCAPES[char]!);
}

/**
 * Renders tokens as highlight markup.
 *
 * Emitted into a layer that is `aria-hidden` and `pointer-events: none`, sat
 * behind a transparent textarea — so the accessible and editable surface stays
 * a real textarea with native selection, IME, undo and spellcheck behaviour,
 * and this markup only carries colour.
 */
export function renderTokens(tokens: readonly Token[]): string {
  let html = "";
  for (const token of tokens) {
    const text = escapeHTML(token.text);
    html += token.kind === "plain" ? text : `<span class="t-${token.kind}">${text}</span>`;
  }
  // A trailing newline collapses in the layer but not in the textarea, which
  // would desynchronise the two by one line at the very bottom of a document.
  return `${html}\n`;
}

export function highlight(source: string, language: "json" | "yaml"): string {
  if (source.length > HIGHLIGHT_LIMIT) return `${escapeHTML(source)}\n`;
  const tokens = language === "yaml" ? tokenizeYAML(source) : tokenizeJSON(source);
  return renderTokens(tokens);
}

/**
 * Highlights only the lines in `[firstLine, lastLine]` (1-based, inclusive)
 * and emits everything else as plain escaped text.
 *
 * Tokenizing a whole document is linear in its length, which is fine at ten
 * kilobytes and roughly a third of a second at two hundred — long enough to
 * feel like a freeze right after the author stops typing. The overlay only
 * needs colour where the reader is looking, and unhighlighted lines still
 * occupy exactly the same space, so the layer stays aligned with the textarea
 * while the work stays proportional to the viewport rather than the document.
 *
 * Each window is tokenized independently. A construct spanning the window
 * boundary (a multi-line string) can therefore be coloured differently from
 * how it would be in a whole-document pass; that is a deliberate trade, and it
 * self-corrects as soon as the construct scrolls fully into view.
 */
export function highlightWindow(
  source: string,
  language: "json" | "yaml",
  firstLine: number,
  lastLine: number,
): string {
  if (source.length > HIGHLIGHT_LIMIT) return `${escapeHTML(source)}\n`;

  const lines = source.split("\n");
  const start = Math.max(0, firstLine - 1);
  const end = Math.min(lines.length, lastLine);
  if (start >= end) return `${escapeHTML(source)}\n`;

  const before = lines.slice(0, start).join("\n");
  const middle = lines.slice(start, end).join("\n");
  const after = lines.slice(end).join("\n");

  const tokens =
    language === "yaml" ? tokenizeYAML(middle) : tokenizeJSON(middle);

  let html = "";
  if (start > 0) html += `${escapeHTML(before)}\n`;
  html += renderTokens(tokens).slice(0, -1);
  if (end < lines.length) html += `\n${escapeHTML(after)}`;
  return `${html}\n`;
}
