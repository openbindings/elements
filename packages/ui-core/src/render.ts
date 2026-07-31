/**
 * Incremental rendering substrate.
 *
 * The original substrate rebuilt a whole shadow root on every state change
 * (`renderStatic`). That is correct but quadratic in practice: every render
 * re-parses the component's entire stylesheet, discards live DOM (destroying
 * focus, selection and scroll position), and re-attaches every listener. For
 * a text editor it means the cost of a keystroke scales with the size of the
 * component's CSS.
 *
 * The primitives here keep the same authoring style — write markup as a
 * string — while separating the two things that were conflated:
 *
 *   - the **shell**, parsed once per element instance, and
 *   - the **update**, which mutates the nodes that shell created.
 *
 * Styles move out of the markup entirely and into `adoptedStyleSheets`, so a
 * stylesheet is parsed once per document rather than once per render, and no
 * inline `<style>` is emitted (which also makes the elements usable under a
 * `style-src` policy that forbids inline styles).
 */

const sheetCache = new Map<string, CSSStyleSheet>();

function constructableSheetsSupported(): boolean {
  return (
    typeof globalThis.CSSStyleSheet === "function" &&
    typeof globalThis.ShadowRoot === "function" &&
    "adoptedStyleSheets" in globalThis.ShadowRoot.prototype &&
    // jsdom exposes the property but rejects replaceSync on some versions.
    typeof globalThis.CSSStyleSheet.prototype.replaceSync === "function"
  );
}

/**
 * Returns the shared, parsed stylesheet for `css`, creating it at most once
 * per document. Returns null where constructable stylesheets are unavailable
 * (older engines, some SSR shims), in which case `adoptStyles` falls back to
 * a single `<style>` node that is still only written once per element.
 */
export function sheetFor(css: string): CSSStyleSheet | null {
  if (!constructableSheetsSupported()) return null;
  const cached = sheetCache.get(css);
  if (cached) return cached;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheetCache.set(css, sheet);
    return sheet;
  } catch {
    return null;
  }
}

/**
 * Attaches stylesheets to a shadow root without emitting inline `<style>`.
 * Call once per element instance; repeated calls with the same sources are
 * idempotent.
 */
export function adoptStyles(root: ShadowRoot, ...sources: string[]): void {
  const sheets: CSSStyleSheet[] = [];
  const fallback: string[] = [];
  for (const css of sources) {
    const sheet = sheetFor(css);
    if (sheet) sheets.push(sheet);
    else fallback.push(css);
  }
  if (sheets.length) {
    const existing = root.adoptedStyleSheets ?? [];
    const missing = sheets.filter(sheet => !existing.includes(sheet));
    if (missing.length) root.adoptedStyleSheets = [...existing, ...missing];
  }
  if (fallback.length) {
    const marker = "data-ob-style-fallback";
    if (!root.querySelector(`style[${marker}]`)) {
      const style = document.createElement("style");
      style.setAttribute(marker, "");
      style.textContent = fallback.join("\n");
      root.prepend(style);
    }
  }
}

const templateCache = new Map<string, HTMLTemplateElement>();

/**
 * Parses `markup` once per unique string and returns a fresh clone. Cloning a
 * parsed template is roughly an order of magnitude cheaper than re-parsing
 * markup, and it is what makes per-instance shells affordable.
 */
export function instantiate(markup: string): DocumentFragment {
  let template = templateCache.get(markup);
  if (!template) {
    template = document.createElement("template");
    template.innerHTML = markup;
    templateCache.set(markup, template);
  }
  return template.content.cloneNode(true) as DocumentFragment;
}

/**
 * Builds an element's shell exactly once. Subsequent calls are no-ops, so it
 * is safe to call from a render path that runs on every state change.
 *
 * Returns a lookup bound to the shell that caches `querySelector` results —
 * the nodes are stable for the element's lifetime, so re-querying them on
 * every update is wasted work.
 */
export function renderShell(root: ShadowRoot, markup: string): Refs {
  const existing = shellRefs.get(root);
  if (existing) return existing;
  root.appendChild(instantiate(markup));
  const refs = new Refs(root);
  shellRefs.set(root, refs);
  return refs;
}

const shellRefs = new WeakMap<ShadowRoot, Refs>();

/** Cached, typed node lookup over a rendered shell. */
export class Refs {
  readonly #root: ParentNode;
  readonly #cache = new Map<string, Element | null>();

  constructor(root: ParentNode) {
    this.#root = root;
  }

  /** The first match for `selector`, or null. Cached after the first call. */
  find<T extends Element = HTMLElement>(selector: string): T | null {
    if (this.#cache.has(selector)) {
      return (this.#cache.get(selector) as T | null) ?? null;
    }
    const node = this.#root.querySelector<T>(selector);
    this.#cache.set(selector, node);
    return node;
  }

  /**
   * The first match for `selector`. Throws when absent — use for nodes the
   * shell always contains, so a typo fails loudly instead of silently
   * disabling a control.
   */
  require<T extends Element = HTMLElement>(selector: string): T {
    const node = this.find<T>(selector);
    if (!node) {
      throw new Error(`ob: shell is missing a required node: ${selector}`);
    }
    return node;
  }

  /** Drops cached lookups. Only needed if a shell region is replaced. */
  invalidate(): void {
    this.#cache.clear();
  }
}

export interface ReconcileOptions<T> {
  /** Stable identity for an item. Reused nodes are matched on this. */
  key: (item: T, index: number) => string;
  /** Creates the node for a newly seen key. Runs once per key. */
  create: (item: T, key: string) => HTMLElement;
  /** Updates an existing node in place. Runs on every pass. */
  update?: (node: HTMLElement, item: T, key: string) => void;
  /** Called for nodes whose key disappeared, before removal. */
  destroy?: (node: HTMLElement, key: string) => void;
}

const KEY_ATTRIBUTE = "data-ob-key";

/**
 * Keyed list reconciliation against a container's element children.
 *
 * Nodes whose key survives are moved rather than recreated, so focus,
 * selection, scroll offset, transitions and any listener attached to the node
 * survive a re-render. This is what lets a tab strip re-render on every
 * keystroke elsewhere in the app without stealing focus or flashing.
 */
export function reconcile<T>(
  container: Element,
  items: readonly T[],
  options: ReconcileOptions<T>,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = child.getAttribute(KEY_ATTRIBUTE);
    if (key !== null && child instanceof HTMLElement) existing.set(key, child);
  }

  const seen = new Set<string>();
  let cursor: ChildNode | null = container.firstChild;

  items.forEach((item, index) => {
    const key = options.key(item, index);
    if (seen.has(key)) {
      throw new Error(`ob: duplicate reconcile key: ${key}`);
    }
    seen.add(key);

    let node = existing.get(key);
    if (node) {
      existing.delete(key);
      options.update?.(node, item, key);
    } else {
      node = options.create(item, key);
      node.setAttribute(KEY_ATTRIBUTE, key);
      options.update?.(node, item, key);
    }

    if (cursor === node) {
      cursor = node.nextSibling;
    } else {
      container.insertBefore(node, cursor);
    }
  });

  for (const [key, node] of existing) {
    options.destroy?.(node, key);
    node.remove();
  }
}

/** Sets an attribute when `value` is truthy and removes it otherwise. */
export function toggleAttribute(
  node: Element,
  name: string,
  value: unknown,
): void {
  if (value) node.setAttribute(name, "");
  else node.removeAttribute(name);
}

/** Assigns `textContent` only when it differs, avoiding needless layout. */
export function setTextIfChanged(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/**
 * Trailing debounce on an animation-frame-friendly timer.
 *
 * Used to keep expensive derived work — schema validation, re-highlighting,
 * persistence — off the keystroke path while leaving the keystroke itself
 * synchronous, so typing never feels laggy.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { cancel(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (): void => {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };

  const debounced = (...args: A): void => {
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  };

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      run();
    }
  };

  return debounced;
}
