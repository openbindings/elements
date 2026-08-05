import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/**
 * Locating a document path inside the EDITOR'S OWN TEXT (rev 17.14).
 *
 * The workbench's views — rail, tabs, detail, schemas — are all views onto
 * one document, so navigating in any of them can reveal the corresponding
 * node in the source editor. The lookup runs against the CURRENT buffer,
 * dirty draft included: there is no external source of truth to consult.
 *
 * CodeMirror parses LAZILY — `syntaxTree(state)` is only complete to roughly
 * the viewport, so a naive descent finds the first operation in a large
 * document and silently misses the hundredth. `ensureSyntaxTree` forces the
 * parse with a time budget; blowing the budget is reported as "not found"
 * rather than a wrong position.
 */

export type LocateLanguage = "json" | "yaml";

export interface LocatedRange {
  /** Start of the located node (its key, when the parent is a mapping). */
  from: number;
  /** End of the located node's value. */
  to: number;
}

/** Parse budget for a reveal. Generous for a keystroke, bounded for a jump. */
const PARSE_BUDGET_MS = 500;

export function locatePath(
  state: EditorState,
  path: ReadonlyArray<string | number>,
  language: LocateLanguage,
): LocatedRange | null {
  if (path.length === 0) return null;
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  if (!tree) return null;

  let node: SyntaxNode | null = tree.topNode;
  let located: LocatedRange | null = null;
  for (const step of path) {
    if (!node) return null;
    const found =
      typeof step === "number"
        ? indexIn(node, step, language)
        : propertyIn(node, step, state, language);
    if (!found) return null;
    located = { from: found.from, to: found.to };
    node = found.value;
  }
  return located;
}

interface FoundStep {
  /** Range to reveal — the key plus its value, when there is a key. */
  from: number;
  to: number;
  /** The value node, to descend into for the next path step. */
  value: SyntaxNode | null;
}

const MAPPINGS: Record<LocateLanguage, ReadonlySet<string>> = {
  json: new Set(["Object"]),
  yaml: new Set(["BlockMapping", "FlowMapping"]),
};

const PAIRS: Record<LocateLanguage, string> = {
  json: "Property",
  yaml: "Pair",
};

const KEYS: Record<LocateLanguage, ReadonlySet<string>> = {
  json: new Set(["PropertyName"]),
  yaml: new Set(["Key"]),
};

const SEQUENCES: Record<LocateLanguage, ReadonlySet<string>> = {
  json: new Set(["Array"]),
  yaml: new Set(["BlockSequence", "FlowSequence"]),
};

/** Descends through wrapper nodes (JsonText, Stream, Document) to a target. */
function containerIn(
  node: SyntaxNode,
  kinds: ReadonlySet<string>,
  depth = 0,
): SyntaxNode | null {
  if (kinds.has(node.name)) return node;
  if (depth > 4) return null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const found = containerIn(child, kinds, depth + 1);
    if (found) return found;
  }
  return null;
}

function propertyIn(
  node: SyntaxNode,
  key: string,
  state: EditorState,
  language: LocateLanguage,
): FoundStep | null {
  const mapping = containerIn(node, MAPPINGS[language]);
  if (!mapping) return null;
  const pairName = PAIRS[language];
  const keyNames = KEYS[language];
  for (let child = mapping.firstChild; child; child = child.nextSibling) {
    if (child.name !== pairName) continue;
    const keyNode = firstOf(child, keyNames);
    if (!keyNode) continue;
    if (unquote(state.sliceDoc(keyNode.from, keyNode.to).trim()) !== key) {
      continue;
    }
    return { from: child.from, to: child.to, value: valueOf(child, keyNode) };
  }
  return null;
}

function indexIn(
  node: SyntaxNode,
  index: number,
  language: LocateLanguage,
): FoundStep | null {
  const sequence = containerIn(node, SEQUENCES[language]);
  if (!sequence) return null;
  let position = 0;
  for (let child = sequence.firstChild; child; child = child.nextSibling) {
    // Punctuation carries no name of interest; value nodes are the members.
    if (isPunctuation(child.name)) continue;
    if (position === index) {
      const value = child.name === "Item" ? (child.firstChild ?? child) : child;
      return { from: child.from, to: child.to, value };
    }
    position += 1;
  }
  return null;
}

function firstOf(
  node: SyntaxNode,
  names: ReadonlySet<string>,
): SyntaxNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (names.has(child.name)) return child;
  }
  return null;
}

/** The pair's value: the last child that is neither the key nor punctuation. */
function valueOf(pair: SyntaxNode, keyNode: SyntaxNode): SyntaxNode | null {
  let value: SyntaxNode | null = null;
  for (let child = pair.firstChild; child; child = child.nextSibling) {
    if (child.from === keyNode.from && child.to === keyNode.to) continue;
    if (isPunctuation(child.name)) continue;
    value = child;
  }
  return value;
}

function isPunctuation(name: string): boolean {
  return (
    name === ":" ||
    name === "," ||
    name === "{" ||
    name === "}" ||
    name === "[" ||
    name === "]" ||
    name === "-"
  );
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      try {
        return first === '"' ? (JSON.parse(text) as string) : text.slice(1, -1);
      } catch {
        return text.slice(1, -1);
      }
    }
  }
  return text;
}
