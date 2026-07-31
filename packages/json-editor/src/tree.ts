/**
 * Collapsible JSON tree view.
 *
 * Only expanded subtrees are materialised, so opening a large document costs
 * one row per visible line rather than one per node. Collapse state is keyed
 * by JSON Pointer and survives re-rendering, re-parsing and switching views —
 * losing the reader's place on every keystroke was the main reason a tree is
 * usually worse than a textarea.
 */

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface TreeEditDetail {
  /** JSON Pointer (RFC 6901) of the edited node. */
  pointer: string;
  value: JSONValue;
}

/** Children rendered per container before a "show remaining" control. */
const PAGE_SIZE = 200;

export interface JSONTreeOptions {
  onEdit?: (detail: TreeEditDetail) => void;
  readOnly?: boolean;
}

export class JSONTree {
  readonly #container: HTMLElement;
  readonly #collapsed = new Set<string>();
  readonly #pageLimit = new Map<string, number>();
  #value: JSONValue | undefined;
  #options: JSONTreeOptions;

  constructor(container: HTMLElement, options: JSONTreeOptions = {}) {
    this.#container = container;
    this.#options = options;
  }

  set options(value: JSONTreeOptions) {
    this.#options = value;
  }

  get value(): JSONValue | undefined {
    return this.#value;
  }

  setValue(value: JSONValue | undefined, { reset = false } = {}): void {
    this.#value = value;
    if (reset) {
      this.#collapsed.clear();
      this.#pageLimit.clear();
      this.#collapseDeep(value, "", 2);
    }
    this.render();
  }

  expandAll(): void {
    this.#collapsed.clear();
    this.render();
  }

  collapseAll(): void {
    this.#collapsed.clear();
    this.#collapseDeep(this.#value, "", 1);
    this.render();
  }

  render(): void {
    this.#container.replaceChildren();
    if (this.#value === undefined) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = "Nothing to show — the document is not valid yet.";
      this.#container.append(empty);
      return;
    }
    this.#renderNode(this.#container, this.#value, "", null, 0);
  }

  /** Collapses every container deeper than `keepDepth` levels. */
  #collapseDeep(value: JSONValue | undefined, pointer: string, keepDepth: number, depth = 0): void {
    if (!isContainer(value)) return;
    if (depth >= keepDepth) this.#collapsed.add(pointer);
    for (const [childKey, childValue] of entriesOf(value)) {
      this.#collapseDeep(childValue, `${pointer}/${escapePointer(childKey)}`, keepDepth, depth + 1);
    }
  }

  #renderNode(
    parent: HTMLElement,
    value: JSONValue,
    pointer: string,
    label: string | null,
    depth: number,
  ): void {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.setProperty("--depth", String(depth));
    row.dataset.pointer = pointer;

    const container = isContainer(value);
    const collapsed = this.#collapsed.has(pointer);

    if (container) {
      const twisty = document.createElement("button");
      twisty.type = "button";
      twisty.className = "twisty";
      twisty.setAttribute("aria-expanded", String(!collapsed));
      twisty.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} ${label ?? "root"}`,
      );
      twisty.textContent = collapsed ? "▸" : "▾";
      twisty.addEventListener("click", () => {
        if (this.#collapsed.has(pointer)) this.#collapsed.delete(pointer);
        else this.#collapsed.add(pointer);
        this.render();
        this.#container
          .querySelector<HTMLElement>(`[data-pointer="${cssEscape(pointer)}"] .twisty`)
          ?.focus();
      });
      row.append(twisty);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "twisty-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.append(spacer);
    }

    if (label !== null) {
      const key = document.createElement("span");
      key.className = "tree-key";
      key.textContent = label;
      row.append(key, document.createTextNode(": "));
    }

    if (container) {
      const summary = document.createElement("span");
      summary.className = "tree-summary";
      const count = Array.isArray(value)
        ? value.length
        : Object.keys(value).length;
      summary.textContent = Array.isArray(value)
        ? `[] ${count} item${count === 1 ? "" : "s"}`
        : `{} ${count} key${count === 1 ? "" : "s"}`;
      row.append(summary);
    } else {
      row.append(this.#leaf(value, pointer));
    }

    parent.append(row);

    if (!container || collapsed) return;

    const children = entriesOf(value);
    const limit = this.#pageLimit.get(pointer) ?? PAGE_SIZE;
    for (const [childKey, childValue] of children.slice(0, limit)) {
      this.#renderNode(
        parent,
        childValue,
        `${pointer}/${escapePointer(childKey)}`,
        childKey,
        depth + 1,
      );
    }
    if (children.length > limit) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "tree-more";
      more.style.setProperty("--depth", String(depth + 1));
      more.textContent = `Show ${children.length - limit} more…`;
      more.addEventListener("click", () => {
        this.#pageLimit.set(pointer, limit + PAGE_SIZE);
        this.render();
      });
      parent.append(more);
    }
  }

  #leaf(value: JSONValue, pointer: string): HTMLElement {
    const node = document.createElement("span");
    node.className = `tree-value ${leafKind(value)}`;
    node.textContent = formatLeaf(value);

    if (this.#options.readOnly || !this.#options.onEdit) {
      return node;
    }

    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.title = "Edit value";
    const begin = (): void => this.#beginEdit(node, value, pointer);
    node.addEventListener("click", begin);
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        begin();
      }
    });
    return node;
  }

  #beginEdit(node: HTMLElement, value: JSONValue, pointer: string): void {
    const input = document.createElement("input");
    input.className = "tree-edit";
    input.value = typeof value === "string" ? value : formatLeaf(value);
    input.setAttribute("aria-label", `Value at ${pointer || "root"}`);

    const commit = (): void => {
      const next = coerceLeaf(input.value, value);
      input.replaceWith(node);
      if (next === value) return;
      node.textContent = formatLeaf(next);
      node.className = `tree-value ${leafKind(next)}`;
      this.#options.onEdit?.({ pointer, value: next });
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.removeEventListener("blur", commit);
        input.replaceWith(node);
        node.focus();
      }
    });

    node.replaceWith(input);
    input.focus();
    input.select();
  }
}

/**
 * Immutably writes `value` at `pointer`, returning a new document. Used to
 * apply a tree edit without mutating the caller's object, so the editor never
 * silently changes a value an application still holds a reference to.
 */
export function setAtPointer(
  document_: JSONValue,
  pointer: string,
  value: JSONValue,
): JSONValue {
  if (!pointer) return value;
  const segments = pointer
    .slice(1)
    .split("/")
    .map(unescapePointer);
  return write(document_, segments, value);
}

function write(target: JSONValue, segments: string[], value: JSONValue): JSONValue {
  const [head, ...rest] = segments;
  if (head === undefined) return value;

  if (Array.isArray(target)) {
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= target.length) {
      return target;
    }
    const next = [...target];
    next[index] = write(target[index]!, rest, value);
    return next;
  }

  if (target !== null && typeof target === "object") {
    if (!(head in target)) return target;
    return { ...target, [head]: write(target[head]!, rest, value) };
  }

  return target;
}

function entriesOf(value: JSONValue): [string, JSONValue][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (value !== null && typeof value === "object") return Object.entries(value);
  return [];
}

function isContainer(value: unknown): value is JSONValue[] | Record<string, JSONValue> {
  return typeof value === "object" && value !== null;
}

function leafKind(value: JSONValue): string {
  if (value === null) return "is-null";
  return `is-${typeof value}`;
}

function formatLeaf(value: JSONValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * Interprets edited text, preserving the original type where the author
 * clearly meant to keep it. Editing a string yields a string even when it
 * looks numeric; editing a number or boolean parses, and falls back to a
 * string when the text is not valid JSON.
 */
function coerceLeaf(text: string, original: JSONValue): JSONValue {
  if (typeof original === "string") return text;
  const trimmed = text.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return text;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function cssEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
