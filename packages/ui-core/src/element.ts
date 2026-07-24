type HTMLElementConstructor = typeof HTMLElement;

const HTMLElementBase: HTMLElementConstructor =
  typeof globalThis.HTMLElement === "function"
    ? globalThis.HTMLElement
    : (class {} as unknown as HTMLElementConstructor);

/** Shared, import-safe base for the platform-native element packages. */
export abstract class OpenBindingsElement extends HTMLElementBase {
  #renderQueued = false;
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
