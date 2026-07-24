import type { OBInterface, Operation } from "@openbindings/sdk";
import {
  OpenBindingsElement,
  baseStyles,
  renderStatic,
} from "@openbindings/ui-core";

export const OBI_EXPLORER_TAG = "ob-obi-explorer";

export interface OperationSelectDetail {
  operationKey: string;
  operation: Operation;
}

export interface OBIExplorerEventMap {
  "ob-operation-select": CustomEvent<OperationSelectDetail>;
}

export class OBIExplorerElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #selectedOperation: string | null = null;
  #filter = "";

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    if (
      this.#selectedOperation &&
      !Object.hasOwn(value?.operations ?? {}, this.#selectedOperation)
    ) {
      this.#selectedOperation = null;
    }
    this.requestRender();
  }

  get selectedOperation(): string | null {
    return this.#selectedOperation;
  }

  set selectedOperation(value: string | null) {
    if (value === this.#selectedOperation) return;
    this.#selectedOperation = value;
    this.requestRender();
  }

  get filter(): string {
    return this.#filter;
  }

  set filter(value: string) {
    const normalized = value ?? "";
    if (normalized === this.#filter) return;
    this.#filter = normalized;
    this.requestRender();
  }

  protected render(): void {
    const root = this.renderRoot;
    if (!root) return;
    const previousFilter = root.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    const restoreFilterFocus = root.activeElement === previousFilter;
    const selectionStart = previousFilter?.selectionStart ?? null;
    const selectionEnd = previousFilter?.selectionEnd ?? null;

    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <section class="container" part="container" aria-label="OpenBindings interface explorer">
         <header part="header">
           <div>
             <h2></h2>
             <p class="version"></p>
           </div>
           <span class="count" aria-label="Operation count"></span>
         </header>
         <p class="description"></p>
         <label class="filter-label">
           <span class="sr-only">Filter operations</span>
           <input part="filter" type="search" placeholder="Filter operations" />
         </label>
         <div class="empty" part="empty"></div>
         <ul part="operation-list" aria-label="Operations"></ul>
       </section>`,
    );

    const title = root.querySelector("h2");
    const version = root.querySelector(".version");
    const description = root.querySelector(".description") as HTMLElement | null;
    const count = root.querySelector(".count");
    const input = root.querySelector("input");
    const empty = root.querySelector(".empty") as HTMLElement | null;
    const list = root.querySelector("ul");

    if (!this.#obi) {
      if (title) title.textContent = "No interface";
      if (version) version.textContent = "";
      if (count) count.textContent = "0";
      if (description) description.hidden = true;
      if (input) input.disabled = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Assign an OBI document to explore its operations.";
      }
      if (list) list.hidden = true;
      return;
    }

    if (title) title.textContent = this.#obi.name ?? "OpenBindings interface";
    if (version) {
      version.textContent = [
        this.#obi.version ? `v${this.#obi.version}` : "",
        `OBI ${this.#obi.openbindings}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (description) {
      description.hidden = !this.#obi.description;
      description.textContent = this.#obi.description ?? "";
    }

    const operations = Object.entries(this.#obi.operations).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const query = this.#filter.trim().toLocaleLowerCase();
    const visible = operations.filter(([key, operation]) => {
      if (!query) return true;
      const haystack = [
        key,
        operation.description ?? "",
        ...(operation.aliases ?? []),
        ...(operation.tags ?? []),
      ]
        .join("\n")
        .toLocaleLowerCase();
      return haystack.includes(query);
    });

    if (count) count.textContent = String(operations.length);
    if (input) {
      input.value = this.#filter;
      input.addEventListener("input", () => {
        this.#filter = input.value;
        this.requestRender();
      });
      if (restoreFilterFocus) {
        input.focus({ preventScroll: true });
        if (selectionStart !== null && selectionEnd !== null) {
          input.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
    if (empty) {
      empty.hidden = visible.length > 0;
      empty.textContent =
        operations.length === 0
          ? "This interface declares no operations."
          : "No operations match this filter.";
    }
    if (!list) return;
    list.hidden = visible.length === 0;

    for (const [key, operation] of visible) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const keyText = document.createElement("span");
      const summary = document.createElement("span");
      const tags = document.createElement("span");

      button.type = "button";
      button.setAttribute("part", "operation");
      if (key === this.#selectedOperation) {
        button.setAttribute("aria-current", "true");
      }
      button.classList.toggle("selected", key === this.#selectedOperation);

      keyText.className = "operation-key";
      keyText.textContent = key;
      summary.className = "operation-summary";
      summary.textContent = operation.description ?? "No description";
      tags.className = "tags";
      for (const tag of operation.tags ?? []) {
        const token = document.createElement("span");
        token.textContent = tag;
        tags.append(token);
      }

      button.append(keyText, summary, tags);
      button.addEventListener("click", () => {
        this.#selectedOperation = key;
        this.requestRender();
        this.emit<OperationSelectDetail>("ob-operation-select", {
          operationKey: key,
          operation,
        });
      });
      item.append(button);
      list.append(item);
    }
  }
}

export interface OBIExplorerElement {
  addEventListener<K extends keyof OBIExplorerEventMap>(
    type: K,
    listener: (
      this: OBIExplorerElement,
      event: OBIExplorerEventMap[K],
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
    "ob-obi-explorer": OBIExplorerElement;
  }
}

const styles = `
  .container {
    min-width: 13rem;
    height: 100%;
    overflow: auto;
    padding: calc(var(--ob-space) * 1.25);
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  header {
    display: flex;
    gap: var(--ob-space);
    align-items: start;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.25;
  }

  .version, .description {
    color: var(--ob-color-text-muted);
  }

  .version {
    margin: 0.2rem 0 0;
    font-family: var(--ob-font-mono);
    font-size: 0.72rem;
  }

  .description {
    margin: var(--ob-space) 0;
  }

  .count {
    min-width: 1.6rem;
    padding: 0.12rem 0.4rem;
    color: var(--ob-color-text-muted);
    text-align: center;
    background: var(--ob-color-surface);
    border-radius: 999px;
  }

  .filter-label {
    display: block;
    margin: var(--ob-space) 0;
  }

  input {
    width: 100%;
    min-height: 2.25rem;
    padding: 0.4rem 0.65rem;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  ul {
    display: grid;
    gap: 0.35rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  button {
    display: grid;
    width: 100%;
    gap: 0.18rem;
    padding: 0.65rem;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ob-radius);
    cursor: pointer;
  }

  button:hover {
    background: var(--ob-color-surface);
  }

  button.selected {
    background: color-mix(in srgb, var(--ob-color-accent) 9%, var(--ob-color-background));
    border-color: color-mix(in srgb, var(--ob-color-accent) 35%, var(--ob-color-border));
  }

  .operation-key {
    overflow-wrap: anywhere;
    font-family: var(--ob-font-mono);
    font-size: 0.78rem;
    font-weight: 650;
  }

  .operation-summary {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ob-color-text-muted);
    font-size: 0.78rem;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tags span {
    padding: 0.06rem 0.3rem;
    color: var(--ob-color-text-muted);
    font-size: 0.66rem;
    background: var(--ob-color-surface-strong);
    border-radius: 999px;
  }

  .empty {
    padding: calc(var(--ob-space) * 2) var(--ob-space);
    color: var(--ob-color-text-muted);
    text-align: center;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;
