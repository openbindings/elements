import {
  OpenBindingsElement,
  baseStyles,
  renderStatic,
} from "@openbindings/ui-core";

export const OPERATION_TABS_TAG = "ob-operation-tabs";

export interface OperationTab {
  key: string;
  label?: string;
  dirty?: boolean;
  running?: boolean;
}

export interface OperationTabKeyDetail {
  key: string;
}

export interface OperationTabReorderDetail {
  keys: string[];
}

export interface OperationTabsEventMap {
  "ob-tab-activate": CustomEvent<OperationTabKeyDetail>;
  "ob-tab-close": CustomEvent<OperationTabKeyDetail>;
  "ob-tab-reorder": CustomEvent<OperationTabReorderDetail>;
  "ob-tabs-close-unselected": CustomEvent<Record<string, never>>;
  "ob-tabs-close-all": CustomEvent<Record<string, never>>;
}

export class OperationTabsElement extends OpenBindingsElement {
  #tabs: OperationTab[] = [];
  #activeKey: string | null = null;
  #dragKey: string | null = null;

  get tabs(): readonly OperationTab[] {
    return this.#tabs;
  }

  set tabs(value: readonly OperationTab[]) {
    const seen = new Set<string>();
    this.#tabs = (value ?? []).flatMap(tab => {
      const key = tab.key?.trim();
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [
        {
          key,
          ...(tab.label?.trim() ? { label: tab.label.trim() } : {}),
          ...(tab.dirty ? { dirty: true } : {}),
          ...(tab.running ? { running: true } : {}),
        },
      ];
    });
    this.requestRender();
  }

  get activeKey(): string | null {
    return this.#activeKey;
  }

  set activeKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#activeKey) return;
    this.#activeKey = normalized;
    this.requestRender();
  }

  protected override render(): void {
    const root = this.renderRoot;
    if (!root) return;
    const focusedKey =
      root.activeElement instanceof HTMLElement
        ? root.activeElement.closest<HTMLElement>("[data-tab-key]")?.dataset
            .tabKey ?? null
        : null;
    const html = this.#tabs.length
      ? this.#tabs.map(tab => this.#tabTemplate(tab)).join("")
      : `<p class="empty" part="empty">No operations open</p>`;
    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <div class="container" part="container">
         <div class="tab-list" part="tab-list" role="tablist" aria-label="Open operations">
           ${html}
         </div>
         <details class="menu" part="menu" ${this.#tabs.length ? "" : "hidden"}>
           <summary aria-label="Operation tab actions" title="Operation tab actions">•••</summary>
           <div class="menu-popover">
             <button type="button" data-action="move-left"${
               !this.#canMoveActive(-1) ? " disabled" : ""
             }>Move active tab left</button>
             <button type="button" data-action="move-right"${
               !this.#canMoveActive(1) ? " disabled" : ""
             }>Move active tab right</button>
             <button type="button" data-action="close-unselected"${
               this.#tabs.length < 2 ? " disabled" : ""
             }>Close other tabs</button>
             <button type="button" data-action="close-all">Close all tabs</button>
           </div>
         </details>
       </div>`,
    );

    for (const shell of root.querySelectorAll<HTMLElement>(".tab-shell")) {
      const key = shell.dataset.tabKey;
      if (!key) continue;
      const button = shell.querySelector<HTMLButtonElement>(".tab-button");
      const close = shell.querySelector<HTMLButtonElement>(".close");
      button?.addEventListener("click", () => this.#activate(key));
      button?.addEventListener("keydown", event =>
        this.#handleTabKeydown(event, key),
      );
      close?.addEventListener("click", event => {
        event.stopPropagation();
        this.emit("ob-tab-close", { key });
      });
      shell.addEventListener("dragstart", event => {
        this.#dragKey = key;
        shell.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      shell.addEventListener("dragend", () => {
        this.#dragKey = null;
        shell.classList.remove("dragging");
      });
      shell.addEventListener("dragover", event => {
        if (!this.#dragKey || this.#dragKey === key) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        shell.classList.add("drop-target");
      });
      shell.addEventListener("dragleave", () =>
        shell.classList.remove("drop-target"),
      );
      shell.addEventListener("drop", event => {
        event.preventDefault();
        shell.classList.remove("drop-target");
        const source =
          this.#dragKey || event.dataTransfer?.getData("text/plain") || "";
        this.#requestMove(source, key);
      });
    }

    root
      .querySelector<HTMLButtonElement>('[data-action="move-left"]')
      ?.addEventListener("click", () => this.#requestActiveMove(-1));
    root
      .querySelector<HTMLButtonElement>('[data-action="move-right"]')
      ?.addEventListener("click", () => this.#requestActiveMove(1));
    root
      .querySelector<HTMLButtonElement>('[data-action="close-unselected"]')
      ?.addEventListener("click", () =>
        this.emit("ob-tabs-close-unselected", {}),
      );
    root
      .querySelector<HTMLButtonElement>('[data-action="close-all"]')
      ?.addEventListener("click", () => this.emit("ob-tabs-close-all", {}));

    if (focusedKey) {
      this.#buttonFor(focusedKey)?.focus();
    }
    const active = root.querySelector<HTMLElement>(".tab-shell.active");
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  #tabTemplate(tab: OperationTab): string {
    const active = tab.key === this.#activeKey;
    const label = escapeHTML(tab.label || tab.key);
    const key = escapeHTML(tab.key);
    const status = tab.running
      ? `<span class="status running" part="status" aria-label="Invocation running" title="Invocation running"></span>`
      : tab.dirty
        ? `<span class="status dirty" part="status" aria-label="Unsaved changes" title="Unsaved changes"></span>`
        : "";
    return `<div class="tab-shell${active ? " active" : ""}" data-tab-key="${key}" draggable="true" part="tab${active ? " active-tab" : ""}">
      <button
        class="tab-button"
        type="button"
        role="tab"
        aria-selected="${active}"
        tabindex="${active || (!this.#activeKey && this.#tabs[0]?.key === tab.key) ? "0" : "-1"}"
        data-focus-key="${key}"
        title="${label}"
      >${status}<span class="label">${label}</span></button>
      <button class="close" part="close" type="button" aria-label="Close ${label}" title="Close ${label}">×</button>
    </div>`;
  }

  #activate(key: string): void {
    this.emit("ob-tab-activate", { key });
  }

  #handleTabKeydown(event: KeyboardEvent, key: string): void {
    const keys = this.#tabs.map(tab => tab.key);
    const index = keys.indexOf(key);
    if (index < 0) return;
    if (
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const target = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (target < 0 || target >= keys.length) return;
      const next = [...keys];
      [next[index], next[target]] = [next[target]!, next[index]!];
      this.emit("ob-tab-reorder", { keys: next });
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      this.emit("ob-tab-close", { key });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.#activate(key);
      return;
    }
    let target = index;
    if (event.key === "ArrowLeft") target = (index - 1 + keys.length) % keys.length;
    else if (event.key === "ArrowRight")
      target = (index + 1) % keys.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = keys.length - 1;
    else return;
    event.preventDefault();
    const nextKey = keys[target];
    if (!nextKey) return;
    this.#buttonFor(nextKey)?.focus();
  }

  #buttonFor(key: string): HTMLButtonElement | undefined {
    return [
      ...(this.renderRoot?.querySelectorAll<HTMLButtonElement>(
        ".tab-button",
      ) ?? []),
    ].find(button => button.dataset.focusKey === key);
  }

  #requestMove(source: string, target: string): void {
    if (!source || source === target) return;
    const keys = this.#tabs.map(tab => tab.key);
    const sourceIndex = keys.indexOf(source);
    const targetIndex = keys.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    keys.splice(sourceIndex, 1);
    keys.splice(targetIndex, 0, source);
    this.emit("ob-tab-reorder", { keys });
  }

  #canMoveActive(direction: -1 | 1): boolean {
    if (!this.#activeKey) return false;
    const index = this.#tabs.findIndex(tab => tab.key === this.#activeKey);
    const target = index + direction;
    return index >= 0 && target >= 0 && target < this.#tabs.length;
  }

  #requestActiveMove(direction: -1 | 1): void {
    if (!this.#activeKey || !this.#canMoveActive(direction)) return;
    const keys = this.#tabs.map(tab => tab.key);
    const index = keys.indexOf(this.#activeKey);
    const target = index + direction;
    [keys[index], keys[target]] = [keys[target]!, keys[index]!];
    this.emit("ob-tab-reorder", { keys });
  }
}

export interface OperationTabsElement {
  addEventListener<K extends keyof OperationTabsEventMap>(
    type: K,
    listener: (
      this: OperationTabsElement,
      event: OperationTabsEventMap[K],
    ) => void,
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
    "ob-operation-tabs": OperationTabsElement;
  }
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const styles = `
  :host {
    display: block;
    min-width: 0;
  }

  .container {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    height: 100%;
    background: var(--ob-color-surface);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  .tab-list {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .tab-shell {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 8rem;
    max-width: 20rem;
    flex: 0 1 14rem;
    align-items: center;
    color: var(--ob-color-text-muted);
    border-right: 1px solid var(--ob-color-border);
  }

  .tab-shell.active {
    color: var(--ob-color-text);
    background: var(--ob-color-background);
  }

  .tab-shell.active::before {
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    content: "";
    background: var(--ob-color-accent);
  }

  .tab-shell.dragging {
    opacity: 0.5;
  }

  .tab-shell.drop-target {
    box-shadow: inset 3px 0 var(--ob-color-accent);
  }

  .tab-button,
  .close,
  .menu button {
    min-width: 0;
    min-height: 2.25rem;
    padding: 0 0.65rem;
    color: inherit;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .tab-button {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    text-align: left;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    width: 0.45rem;
    height: 0.45rem;
    flex: 0 0 auto;
    background: var(--ob-color-text-muted);
    border-radius: 50%;
  }

  .status.running {
    background: var(--ob-color-success);
    box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--ob-color-success) 16%, transparent);
  }

  .status.dirty {
    background: var(--ob-color-accent);
  }

  .close {
    width: 2rem;
    padding: 0;
    color: var(--ob-color-text-muted);
    font-size: 1rem;
    opacity: 0.65;
  }

  .close:hover,
  .close:focus-visible {
    color: var(--ob-color-text);
    background: var(--ob-color-surface-strong);
    opacity: 1;
  }

  .empty {
    align-self: center;
    padding: 0 0.75rem;
    margin: 0;
    color: var(--ob-color-text-muted);
    font-size: 0.78rem;
  }

  .menu {
    position: relative;
    border-left: 1px solid var(--ob-color-border);
  }

  .menu > summary {
    display: grid;
    width: 2.5rem;
    height: 100%;
    min-height: 2.25rem;
    place-items: center;
    list-style: none;
    cursor: pointer;
  }

  .menu > summary::-webkit-details-marker {
    display: none;
  }

  .menu-popover {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0.25rem;
    z-index: 10;
    display: grid;
    width: 12rem;
    padding: 0.3rem;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
    box-shadow: 0 0.6rem 1.8rem rgb(0 0 0 / 15%);
  }

  .menu button {
    text-align: left;
    border-radius: calc(var(--ob-radius) * 0.65);
  }

  .menu button:hover:not(:disabled) {
    background: var(--ob-color-surface);
  }

  .menu button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;
