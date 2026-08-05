import type { OBInterface } from "@openbindings/sdk";
import {
  CODE_BLOCK_STYLES,
  renderCodeBlock,
} from "@openbindings/json-editor/highlight";
import {
  OpenBindingsElement,
  baseStyles,
  formatJSON,
  reconcile,
  setTextIfChanged,
} from "@openbindings/ui-core";

export const OPERATION_DETAIL_TAG = "ob-operation-detail";

/**
 * The operation contract, read-only. Rev 15 (binding roles): the bindings
 * disclosure is informational — it lists the operation's bindings and can
 * highlight the invocation's current choice via `selectedBindingKey`, but it
 * offers no selection affordance and emits nothing. The invocation cockpit's
 * binding-select is the single surface where a binding is chosen.
 */
export class OperationDetailElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #operationKey: string | null = null;
  #selectedBindingKey: string | null = null;
  // True until the next successful render of the bindings disclosure applies
  // the default open state. Raised only when the operation identity changes,
  // so a user's manual toggle survives every other re-render (selection
  // changes, document refreshes) instead of snapping back to the default.
  #bindingsOpenStale = true;

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
    this.#bindingsOpenStale = true;
    this.requestRender();
  }

  /**
   * Display-only highlight of the binding the invocation currently uses.
   * Assigned by the host; the element itself never changes it.
   */
  get selectedBindingKey(): string | null {
    return this.#selectedBindingKey;
  }

  set selectedBindingKey(value: string | null) {
    if (value === this.#selectedBindingKey) return;
    this.#selectedBindingKey = value;
    this.requestRender();
  }

  protected render(): void {
    const refs = this.shell(SHELL, baseStyles, styles, CODE_BLOCK_STYLES);
    if (!refs) return;

    const operation =
      this.#obi && this.#operationKey
        ? this.#obi.operations[this.#operationKey]
        : undefined;
    const empty = refs.require(".empty");
    const content = refs.require(".content");

    if (!this.#obi || !this.#operationKey || !operation) {
      empty.hidden = false;
      setTextIfChanged(
        empty,
        this.#obi
          ? "Select an operation to inspect its contract."
          : "Assign an OBI document and operation key.",
      );
      content.hidden = true;
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    setTextIfChanged(refs.require("h2"), this.#operationKey);

    // Keys are namespaced (flag:*, tag:<index>) rather than raw labels: a tag
    // named "Idempotent" or a duplicate tag string is a legal document and
    // must not collide in reconcile, which rejects duplicate keys.
    const flagLabels = [
      ...(operation.idempotent === true
        ? [["flag:idempotent", "Idempotent", ""] as const]
        : []),
      ...(operation.deprecated === true
        ? [["flag:deprecated", "Deprecated", "danger"] as const]
        : []),
      ...(operation.tags ?? []).map(
        (tag, index) => [`tag:${index}`, tag, ""] as const,
      ),
    ];
    reconcile(refs.require(".flags"), flagLabels, {
      key: ([key]) => key,
      create: () => document.createElement("span"),
      update: (node, [, label, className]) => {
        setTextIfChanged(node, label);
        node.className = className;
      },
    });

    const description = refs.require(".description");
    description.hidden = !operation.description;
    setTextIfChanged(description, operation.description ?? "");

    const aliasValues = operation.aliases ?? [];
    refs.require(".aliases").hidden = aliasValues.length === 0;
    reconcile(refs.require(".alias-list"), aliasValues, {
      // Index-keyed: duplicate alias strings are the document's problem to
      // flag, not a reason to abort the render.
      key: (_alias, index) => `alias:${index}`,
      create: () => document.createElement("code"),
      update: (node, alias) => setTextIfChanged(node, alias),
    });

    const bindingEntries = Object.entries(this.#obi.bindings ?? {})
      .filter(([, binding]) => binding.operation === this.#operationKey)
      .sort(([a], [b]) => a.localeCompare(b));
    refs.require(".bindings").hidden = bindingEntries.length === 0;
    // The default only lands when the operation identity changed; every other
    // pass leaves `open` alone so a manual toggle (and focus inside the body,
    // which reconcile already preserves) survives re-renders.
    if (this.#bindingsOpenStale) {
      this.#bindingsOpenStale = false;
      refs.require<HTMLDetailsElement>(".bindings details").open =
        bindingEntries.length <= 2;
    }
    setTextIfChanged(
      refs.require(".bindings-count"),
      `Bindings · ${bindingEntries.length}`,
    );
    const selectedHere =
      this.#selectedBindingKey !== null &&
      bindingEntries.some(([key]) => key === this.#selectedBindingKey);
    setTextIfChanged(
      refs.require(".bindings-via"),
      selectedHere ? ` · via ${this.#selectedBindingKey}` : "",
    );
    reconcile(refs.require(".binding-list"), bindingEntries, {
      key: ([bindingKey]) => bindingKey,
      create: () => createBindingRow(),
      update: (node, [bindingKey, binding]) => {
        const source = this.#obi?.sources?.[binding.source];
        const selected = bindingKey === this.#selectedBindingKey;
        node.dataset.bindingKey = bindingKey;
        node.classList.toggle("selected", selected);
        setTextIfChanged(node.querySelector(".binding-key")!, bindingKey);
        setTextIfChanged(
          node.querySelector(".binding-family")!,
          source ? `${source.bindingSpec} · ${binding.source}` : binding.source,
        );
      },
    });

    const exampleEntries = Object.entries(operation.examples ?? {}).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    refs.require(".examples").hidden = exampleEntries.length === 0;
    reconcile(refs.require(".example-list"), exampleEntries, {
      key: ([exampleKey]) => exampleKey,
      create: () => document.createElement("article"),
      update: (node, [exampleKey, example]) => {
        const parts: Node[] = [];
        const heading = document.createElement("h4");
        heading.textContent = exampleKey;
        parts.push(heading);
        if (example.description) {
          const paragraph = document.createElement("p");
          paragraph.textContent = example.description;
          parts.push(paragraph);
        }
        for (const direction of ["input", "output"] as const) {
          if (!Object.hasOwn(example, direction)) continue;
          const label = document.createElement("span");
          label.className = "example-direction";
          label.textContent = direction;
          const value = document.createElement("pre");
          renderCodeBlock(value, formatJSON(example[direction]));
          parts.push(label, value);
        }
        node.replaceChildren(...parts);
      },
    });

    // Schemas are reference machine text — the design system's code BLOCK
    // tier (rev 17.5): highlighted statically, never an editor instance.
    const inputSchema = refs.require<HTMLElement>(".input-schema");
    if (operation.input === undefined) {
      setTextIfChanged(inputSchema, "No input schema");
      delete inputSchema.dataset.obCode;
    } else {
      renderCodeBlock(inputSchema, formatJSON(operation.input));
    }
    const outputSchema = refs.require<HTMLElement>(".output-schema");
    if (operation.output === undefined) {
      setTextIfChanged(outputSchema, "No output schema");
      delete outputSchema.dataset.obCode;
    } else {
      renderCodeBlock(outputSchema, formatJSON(operation.output));
    }
  }
}

/** Informational row — deliberately not a button (rev 15, binding roles). */
function createBindingRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "binding-row";
  row.setAttribute("part", "binding");
  const key = document.createElement("span");
  key.className = "binding-key";
  const family = document.createElement("span");
  family.className = "binding-family";
  row.append(key, family);
  return row;
}

const SHELL = `
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
        <details>
          <summary part="bindings-summary"><span class="bindings-count"></span><span class="bindings-via"></span></summary>
          <div class="binding-list" part="binding-list"></div>
        </details>
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
  </article>
`;

declare global {
  interface HTMLElementTagNameMap {
    "ob-operation-detail": OperationDetailElement;
  }
}

const styles = `
  .container {
    height: 100%;
    overflow: auto;
    padding: calc(var(--_ob-space) * 1.5);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--_ob-space);
    align-items: start;
    justify-content: space-between;
  }

  .eyebrow, h2, h3, .description {
    margin: 0;
  }

  .eyebrow {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h2 {
    overflow-wrap: anywhere;
    font-family: var(--_ob-font-mono);
    font-size: 1.05rem;
  }

  h3 {
    margin-bottom: 0.45rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .description {
    max-width: 72ch;
    margin-top: var(--_ob-space);
    color: var(--_ob-color-text-muted);
  }

  .flags, .alias-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .flags span, code {
    padding: 0.12rem 0.38rem;
    background: color-mix(in srgb, var(--_ob-color-surface-strong) 70%, transparent);
    border: 1px solid var(--_ob-color-border);
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .flags .danger {
    color: var(--_ob-color-danger);
  }

  section {
    margin-top: calc(var(--_ob-space) * 1.5);
  }

  .bindings summary {
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .bindings details[open] summary {
    margin-bottom: 0.45rem;
  }

  /* Binding keys are case-sensitive identifiers; keep them verbatim. */
  .bindings-via {
    font-family: var(--_ob-font-mono);
    letter-spacing: normal;
    text-transform: none;
  }

  .binding-list {
    display: grid;
    gap: 0.35rem;
  }

  .example-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
    gap: var(--_ob-space);
  }

  .example-list article {
    min-width: 0;
    padding: var(--_ob-space);
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .example-list h4,
  .example-list p {
    margin: 0;
  }

  .example-list h4 {
    overflow-wrap: anywhere;
    font: 650 0.78rem / 1.4 var(--_ob-font-mono);
  }

  .example-list p {
    margin-top: 0.25rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.74rem;
  }

  .example-direction {
    display: block;
    margin: 0.65rem 0 0.25rem;
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .example-list pre {
    max-height: 12rem;
  }

  .binding-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
    justify-content: space-between;
    width: 100%;
    padding: 0.55rem 0.65rem;
    text-align: left;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .binding-row.selected {
    background: color-mix(in srgb, var(--_ob-color-accent) 9%, var(--_ob-color-background));
    border-color: color-mix(in srgb, var(--_ob-color-accent) 35%, var(--_ob-color-border));
  }

  .binding-key {
    overflow-wrap: anywhere;
    font-family: var(--_ob-font-mono);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .binding-family {
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
  }

  .schemas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
    gap: var(--_ob-space);
  }

  pre {
    max-height: 24rem;
    padding: var(--_ob-space);
    margin: 0;
    overflow: auto;
    color: var(--_ob-color-text);
    font: 0.74rem / 1.5 var(--_ob-font-mono);
    background: var(--_ob-code-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .empty {
    display: grid;
    min-height: 12rem;
    place-items: center;
    color: var(--_ob-color-text-muted);
    text-align: center;
  }
`;
