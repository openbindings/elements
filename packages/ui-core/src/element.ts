import { type Refs, adoptStyles, renderShell } from "./render.js";

type HTMLElementConstructor = typeof HTMLElement;

const HTMLElementBase: HTMLElementConstructor =
  typeof globalThis.HTMLElement === "function"
    ? globalThis.HTMLElement
    : (class {} as unknown as HTMLElementConstructor);

/** Shared, import-safe base for the platform-native element packages. */
export abstract class OpenBindingsElement extends HTMLElementBase {
  #renderQueued = false;
  #shell: Refs | null = null;
  protected readonly renderRoot: ShadowRoot | null;

  constructor(options?: ShadowRootInit) {
    super();
    this.renderRoot =
      typeof this.attachShadow === "function"
        ? this.attachShadow(options ?? { mode: "open" })
        : null;
  }

  connectedCallback(): void {
    this.requestRender();
  }

  /**
   * Builds the element's shell once and adopts its stylesheets, returning a
   * cached node lookup. Safe to call from `render()` on every pass: markup is
   * parsed, and `bind` runs, only on the first call.
   *
   * Elements using this mutate persistent nodes instead of replacing the
   * shadow root, which is what preserves focus, selection and scroll position
   * across state changes — and what keeps a keystroke's cost independent of
   * the size of the component's stylesheet.
   */
  protected shell(markup: string, ...styles: string[]): Refs | null {
    const root = this.renderRoot;
    if (!root) return null;
    if (this.#shell) return this.#shell;
    if (styles.length) adoptStyles(root, ...styles);
    const refs = renderShell(root, markup);
    this.#shell = refs;
    this.bind(refs);
    return refs;
  }

  /**
   * Runs exactly once, immediately after the shell is created. Attach
   * listeners here rather than in `render()`: shell nodes are stable, so a
   * listener bound once stays bound for the element's lifetime.
   */
  protected bind(_refs: Refs): void {}

  protected requestRender(): void {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => {
      this.#renderQueued = false;
      if (!this.isConnected || !this.renderRoot) return;
      this.render();
    });
  }

  protected emit<T>(name: string, detail: T): boolean {
    return this.dispatchEvent(
      new CustomEvent<T>(name, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected abstract render(): void;
}

/** Defines a tag exactly once when the browser Custom Elements registry exists. */
export function defineElement(
  name: string,
  constructor: CustomElementConstructor,
): void {
  if (typeof globalThis.customElements === "undefined") return;
  if (!globalThis.customElements.get(name)) {
    globalThis.customElements.define(name, constructor);
  }
}
