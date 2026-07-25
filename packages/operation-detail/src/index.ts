import type { BindingEntry, OBInterface } from "@openbindings/sdk";
import {
  OpenBindingsElement,
  baseStyles,
  formatJSON,
  renderStatic,
} from "@openbindings/ui-core";

export const OPERATION_DETAIL_TAG = "ob-operation-detail";

export interface BindingSelectDetail {
  bindingKey: string;
  binding: BindingEntry;
}

export interface OperationDetailEventMap {
  "ob-binding-select": CustomEvent<BindingSelectDetail>;
}

export class OperationDetailElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #operationKey: string | null = null;
  #selectedBindingKey: string | null = null;

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.requestRender();
  }

  get operationKey(): string | null {
    return this.#operationKey;
  }

  set operationKey(value: string | null) {
    if (value === this.#operationKey) return;
    this.#operationKey = value;
    this.#selectedBindingKey = null;
    this.requestRender();
  }

  get selectedBindingKey(): string | null {
    return this.#selectedBindingKey;
  }

  set selectedBindingKey(value: string | null) {
    if (value === this.#selectedBindingKey) return;
    this.#selectedBindingKey = value;
    this.requestRender();
  }

  protected render(): void {
    const root = this.renderRoot;
    if (!root) return;

    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <article class="container" part="container">
         <div class="empty" part="empty"></div>
         <div class="content">
           <header part="header">
             <div>
               <p class="eyebrow">Operation</p>
               <h2></h2>
             </div>
             <div class="flags" part="metadata"></div>
           </header>
           <p class="description"></p>
           <section class="aliases">
             <h3>Aliases</h3>
             <div class="alias-list"></div>
           </section>
           <section class="bindings">
             <h3>Bindings</h3>
             <div class="binding-list" part="binding-list"></div>
           </section>
           <section class="examples" part="examples">
             <h3>Examples</h3>
             <div class="example-list"></div>
           </section>
           <div class="schemas">
             <section part="input-schema">
               <h3>Input schema (as declared)</h3>
               <pre class="input-schema"></pre>
             </section>
             <section part="output-schema">
               <h3>Output schema (as declared)</h3>
               <pre class="output-schema"></pre>
             </section>
           </div>
         </div>
       </article>`,
    );

    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    const empty = root.querySelector(".empty") as HTMLElement | null;
    const content = root.querySelector(".content") as HTMLElement | null;

    if (!this.#obi || !this.#operationKey || !operation) {
      if (empty) {
        empty.textContent = this.#obi
          ? "Select an operation to inspect its contract."
          : "Assign an OBI document and operation key.";
      }
      if (content) content.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    const heading = root.querySelector("h2");
    if (heading) heading.textContent = this.#operationKey;

    const flags = root.querySelector(".flags");
    for (const [label, active] of [
      ["Idempotent", operation.idempotent === true],
      ["Deprecated", operation.deprecated === true],
    ] as const) {
      if (!active || !flags) continue;
      const flag = document.createElement("span");
      flag.textContent = label;
      if (label === "Deprecated") flag.className = "danger";
      flags.append(flag);
    }
    for (const tag of operation.tags ?? []) {
      if (!flags) break;
      const flag = document.createElement("span");
      flag.textContent = tag;
      flags.append(flag);
    }

    const description = root.querySelector(".description") as HTMLElement | null;
    if (description) {
      description.hidden = !operation.description;
      description.textContent = operation.description ?? "";
    }

    const aliases = root.querySelector(".aliases") as HTMLElement | null;
    const aliasList = root.querySelector(".alias-list");
    if (aliases) aliases.hidden = !operation.aliases?.length;
    for (const alias of operation.aliases ?? []) {
      const code = document.createElement("code");
      code.textContent = alias;
      aliasList?.append(code);
    }

    const bindingEntries = Object.entries(this.#obi.bindings ?? {})
      .filter(([, binding]) => binding.operation === this.#operationKey)
      .sort(([a], [b]) => a.localeCompare(b));
    const bindings = root.querySelector(".bindings") as HTMLElement | null;
    const bindingList = root.querySelector(".binding-list");
    if (bindings) bindings.hidden = bindingEntries.length === 0;
    for (const [bindingKey, binding] of bindingEntries) {
      const button = document.createElement("button");
      const key = document.createElement("span");
      const family = document.createElement("span");
      const source = this.#obi.sources?.[binding.source];
      button.type = "button";
      button.setAttribute("part", "binding");
      button.classList.toggle("selected", bindingKey === this.#selectedBindingKey);
      button.setAttribute(
        "aria-pressed",
        String(bindingKey === this.#selectedBindingKey),
      );
      key.className = "binding-key";
      key.textContent = bindingKey;
      family.className = "binding-family";
      family.textContent = source
        ? `${source.bindingSpec} · ${binding.source}`
        : binding.source;
      button.append(key, family);
      button.addEventListener("click", () => {
        this.#selectedBindingKey = bindingKey;
        this.requestRender();
        this.emit<BindingSelectDetail>("ob-binding-select", {
          bindingKey,
          binding,
        });
      });
      bindingList?.append(button);
    }

    const exampleEntries = Object.entries(operation.examples ?? {}).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const examples = root.querySelector(".examples") as HTMLElement | null;
    const exampleList = root.querySelector(".example-list");
    if (examples) examples.hidden = exampleEntries.length === 0;
    for (const [exampleKey, example] of exampleEntries) {
      const article = document.createElement("article");
      const heading = document.createElement("h4");
      heading.textContent = exampleKey;
      article.append(heading);

      if (example.description) {
        const description = document.createElement("p");
        description.textContent = example.description;
        article.append(description);
      }
      for (const direction of ["input", "output"] as const) {
        if (!Object.hasOwn(example, direction)) continue;
        const label = document.createElement("span");
        const value = document.createElement("pre");
        label.className = "example-direction";
        label.textContent = direction;
        value.textContent = formatJSON(example[direction]);
        article.append(label, value);
      }
      exampleList?.append(article);
    }

    const inputSchema = root.querySelector(".input-schema");
    const outputSchema = root.querySelector(".output-schema");
    if (inputSchema) {
      inputSchema.textContent =
        operation.input === undefined
          ? "No input schema"
          : formatJSON(operation.input);
    }
    if (outputSchema) {
      outputSchema.textContent =
        operation.output === undefined
          ? "No output schema"
          : formatJSON(operation.output);
    }
  }
}

export interface OperationDetailElement {
  addEventListener<K extends keyof OperationDetailEventMap>(
    type: K,
    listener: (
      this: OperationDetailElement,
      event: OperationDetailEventMap[K],
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
    "ob-operation-detail": OperationDetailElement;
  }
}

const styles = `
  .container {
    height: 100%;
    overflow: auto;
    padding: calc(var(--ob-space) * 1.5);
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ob-space);
    align-items: start;
    justify-content: space-between;
  }

  .eyebrow, h2, h3, .description {
    margin: 0;
  }

  .eyebrow {
    color: var(--ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2 {
    overflow-wrap: anywhere;
    font-family: var(--ob-font-mono);
    font-size: 1.05rem;
  }

  h3 {
    margin-bottom: 0.45rem;
    color: var(--ob-color-text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .description {
    max-width: 72ch;
    margin-top: var(--ob-space);
    color: var(--ob-color-text-muted);
  }

  .flags, .alias-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .flags span, code {
    padding: 0.12rem 0.38rem;
    background: var(--ob-color-surface-strong);
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .flags .danger {
    color: var(--ob-color-danger);
  }

  section {
    margin-top: calc(var(--ob-space) * 1.5);
  }

  .binding-list {
    display: grid;
    gap: 0.35rem;
  }

  .example-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: var(--ob-space);
  }

  .example-list article {
    min-width: 0;
    padding: var(--ob-space);
    background: var(--ob-color-surface);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  .example-list h4,
  .example-list p {
    margin: 0;
  }

  .example-list h4 {
    overflow-wrap: anywhere;
    font: 650 0.78rem / 1.4 var(--ob-font-mono);
  }

  .example-list p {
    margin-top: 0.25rem;
    color: var(--ob-color-text-muted);
    font-size: 0.74rem;
  }

  .example-direction {
    display: block;
    margin: 0.65rem 0 0.25rem;
    color: var(--ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .example-list pre {
    max-height: 12rem;
  }

  .binding-list button {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
    justify-content: space-between;
    width: 100%;
    padding: 0.55rem 0.65rem;
    text-align: left;
    background: var(--ob-color-surface);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
    cursor: pointer;
  }

  .binding-list button:hover {
    background: var(--ob-color-surface-strong);
  }

  .binding-list button.selected {
    background: color-mix(in srgb, var(--ob-color-accent) 9%, var(--ob-color-background));
    border-color: color-mix(in srgb, var(--ob-color-accent) 35%, var(--ob-color-border));
  }

  .binding-key {
    overflow-wrap: anywhere;
    font-family: var(--ob-font-mono);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .binding-family {
    color: var(--ob-color-text-muted);
    font-size: 0.72rem;
  }

  .schemas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
    gap: var(--ob-space);
  }

  pre {
    max-height: 24rem;
    padding: var(--ob-space);
    margin: 0;
    overflow: auto;
    color: var(--ob-color-text);
    font: 0.74rem / 1.5 var(--ob-font-mono);
    background: var(--ob-color-surface);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty {
    display: grid;
    min-height: 12rem;
    place-items: center;
    color: var(--ob-color-text-muted);
    text-align: center;
  }
`;
