import type { OBInterface } from "@openbindings/sdk";
import {
  OpenBindingsElement,
  baseStyles,
  formatJSON,
  renderStatic,
} from "@openbindings/ui-core";

export const INTERFACE_SOURCES_TAG = "ob-interface-sources";

export interface SourceKeyDetail {
  sourceKey: string;
}

export interface BindingKeyDetail {
  bindingKey: string;
  sourceKey: string;
  operationKey: string;
}

export interface InterfaceSourcesEventMap {
  "ob-source-select": CustomEvent<SourceKeyDetail>;
  "ob-source-refresh": CustomEvent<SourceKeyDetail>;
  "ob-source-remove": CustomEvent<SourceKeyDetail>;
  "ob-binding-select": CustomEvent<BindingKeyDetail>;
  "ob-binding-remove": CustomEvent<BindingKeyDetail>;
}

export class InterfaceSourcesElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #selectedSourceKey: string | null = null;
  #selectedBindingKey: string | null = null;

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.requestRender();
  }

  get selectedSourceKey(): string | null {
    return this.#selectedSourceKey;
  }

  set selectedSourceKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#selectedSourceKey) return;
    this.#selectedSourceKey = normalized;
    this.requestRender();
  }

  get selectedBindingKey(): string | null {
    return this.#selectedBindingKey;
  }

  set selectedBindingKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#selectedBindingKey) return;
    this.#selectedBindingKey = normalized;
    this.requestRender();
  }

  protected override render(): void {
    const root = this.renderRoot;
    if (!root) return;
    const sources = Object.entries(this.#obi?.sources ?? {});
    const bindings = Object.entries(this.#obi?.bindings ?? {});
    const selectedSource =
      (this.#selectedSourceKey &&
        this.#obi?.sources?.[this.#selectedSourceKey]) ||
      null;
    const selectedKey = selectedSource
      ? this.#selectedSourceKey
      : sources[0]?.[0] ?? null;
    const selected = selectedKey ? this.#obi?.sources?.[selectedKey] : null;
    const relatedBindings = selectedKey
      ? bindings.filter(([, binding]) => binding.source === selectedKey)
      : [];

    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <section class="container" part="container" aria-label="Interface sources and bindings">
         <header>
           <div>
             <p class="eyebrow">Interface artifacts</p>
             <h2>Sources and bindings</h2>
           </div>
           <span class="count">${sources.length} source${sources.length === 1 ? "" : "s"} · ${bindings.length} binding${bindings.length === 1 ? "" : "s"}</span>
         </header>
         ${
           !this.#obi
             ? `<p class="empty">Assign an OBI document to inspect its artifacts.</p>`
             : sources.length === 0
               ? `<p class="empty">This interface has no declared sources or bindings.</p>`
               : `<div class="workspace">
                    <nav class="source-list" part="source-list" aria-label="Sources">
                      ${sources
                        .map(([key, source]) =>
                          sourceTemplate(key, source.bindingSpec, key === selectedKey),
                        )
                        .join("")}
                    </nav>
                    <article class="source-detail">
                      ${selectedKey && selected ? sourceDetailTemplate(selectedKey, selected, relatedBindings, this.#selectedBindingKey) : ""}
                    </article>
                  </div>`
         }
       </section>`,
    );

    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-source-select]",
    )) {
      button.addEventListener("click", () => {
        const sourceKey = button.dataset.sourceSelect;
        if (sourceKey) this.emit("ob-source-select", { sourceKey });
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-source-action]",
    )) {
      button.addEventListener("click", () => {
        const sourceKey = button.dataset.sourceKey;
        const action = button.dataset.sourceAction;
        if (!sourceKey) return;
        if (action === "refresh") {
          this.emit("ob-source-refresh", { sourceKey });
        } else if (action === "remove") {
          this.emit("ob-source-remove", { sourceKey });
        }
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-binding-select]",
    )) {
      button.addEventListener("click", () => {
        const detail = bindingDetail(button);
        if (detail) this.emit("ob-binding-select", detail);
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-binding-remove]",
    )) {
      button.addEventListener("click", event => {
        event.stopPropagation();
        const detail = bindingDetail(button);
        if (detail) this.emit("ob-binding-remove", detail);
      });
    }
  }
}

function sourceTemplate(
  key: string,
  bindingSpec: string,
  selected: boolean,
): string {
  return `<button
    class="source${selected ? " selected" : ""}"
    part="source${selected ? " selected-source" : ""}"
    type="button"
    data-source-select="${escapeHTML(key)}"
    aria-current="${selected ? "true" : "false"}"
  >
    <strong>${escapeHTML(key)}</strong>
    <span>${escapeHTML(bindingSpec)}</span>
  </button>`;
}

function sourceDetailTemplate(
  sourceKey: string,
  source: NonNullable<OBInterface["sources"]>[string],
  bindings: Array<
    [string, NonNullable<OBInterface["bindings"]>[string]]
  >,
  selectedBindingKey: string | null,
): string {
  const preview =
    source.content === undefined ? null : contentPreview(source.content);
  return `<div class="source-heading">
      <div>
        <p class="eyebrow">Source</p>
        <h3>${escapeHTML(sourceKey)}</h3>
      </div>
      <div class="source-actions" part="source-actions">
        <button type="button" data-source-action="refresh" data-source-key="${escapeHTML(sourceKey)}"${source.location ? "" : " disabled"}>Refresh</button>
        <button class="danger" type="button" data-source-action="remove" data-source-key="${escapeHTML(sourceKey)}">Remove</button>
      </div>
    </div>
    <dl>
      <div><dt>Binding specification</dt><dd><code>${escapeHTML(source.bindingSpec)}</code></dd></div>
      <div><dt>Location</dt><dd>${source.location ? `<code>${escapeHTML(source.location)}</code>` : "Embedded only"}</dd></div>
      <div><dt>Content</dt><dd>${source.content === undefined ? "Not embedded" : typeof source.content === "string" ? "Embedded source text" : "Embedded parsed artifact"}</dd></div>
    </dl>
    ${
      preview === null
        ? ""
        : `<details class="content-preview">
             <summary>Preview embedded content</summary>
             <pre>${escapeHTML(preview.text)}</pre>
             ${preview.truncated ? `<p>Preview truncated at 64 KiB. The supplied source value is unchanged.</p>` : ""}
           </details>`
    }
    <section class="bindings">
      <h3>Bindings from this source</h3>
      <div class="binding-list" part="binding-list">
        ${
          bindings.length
            ? bindings
                .map(([key, binding]) =>
                  bindingTemplate(
                    key,
                    sourceKey,
                    binding.operation,
                    binding.ref,
                    key === selectedBindingKey,
                  ),
                )
                .join("")
            : `<p class="empty compact">No bindings reference this source.</p>`
        }
      </div>
    </section>`;
}

const MAX_CONTENT_PREVIEW_CHARACTERS = 65_536;

function contentPreview(content: unknown): {
  text: string;
  truncated: boolean;
} {
  const text = typeof content === "string" ? content : formatJSON(content);
  if (text.length <= MAX_CONTENT_PREVIEW_CHARACTERS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_CONTENT_PREVIEW_CHARACTERS)}\n…`,
    truncated: true,
  };
}

function bindingTemplate(
  bindingKey: string,
  sourceKey: string,
  operationKey: string,
  ref: string | undefined,
  selected: boolean,
): string {
  const encodedBinding = escapeHTML(bindingKey);
  const encodedSource = escapeHTML(sourceKey);
  const encodedOperation = escapeHTML(operationKey);
  return `<div class="binding-row${selected ? " selected" : ""}" part="binding${selected ? " selected-binding" : ""}">
    <button
      class="binding-select"
      type="button"
      data-binding-select="${encodedBinding}"
      data-binding-key="${encodedBinding}"
      data-source-key="${encodedSource}"
      data-operation-key="${encodedOperation}"
      aria-current="${selected ? "true" : "false"}"
    >
      <strong>${encodedBinding}</strong>
      <span>${encodedOperation}</span>
      <code>${ref ? escapeHTML(ref) : "whole source"}</code>
    </button>
    <button
      class="binding-remove danger"
      type="button"
      aria-label="Remove binding ${encodedBinding}"
      title="Remove binding ${encodedBinding}"
      data-binding-remove="${encodedBinding}"
      data-binding-key="${encodedBinding}"
      data-source-key="${encodedSource}"
      data-operation-key="${encodedOperation}"
    >×</button>
  </div>`;
}

function bindingDetail(element: HTMLElement): BindingKeyDetail | null {
  const bindingKey = element.dataset.bindingKey;
  const sourceKey = element.dataset.sourceKey;
  const operationKey = element.dataset.operationKey;
  return bindingKey && sourceKey && operationKey
    ? { bindingKey, sourceKey, operationKey }
    : null;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export interface InterfaceSourcesElement {
  addEventListener<K extends keyof InterfaceSourcesEventMap>(
    type: K,
    listener: (
      this: InterfaceSourcesElement,
      event: InterfaceSourcesEventMap[K],
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
    "ob-interface-sources": InterfaceSourcesElement;
  }
}

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;
    /* The narrow fallback below must answer to the element's own width, not
       the viewport: in the workbench rail (rev 15) the element is ~22rem wide
       on a desktop viewport. */
    container-type: inline-size;
  }

  .container {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  header,
  .source-heading {
    display: flex;
    gap: var(--_ob-space);
    align-items: center;
    justify-content: space-between;
  }

  header {
    padding: var(--_ob-space);
    background: var(--_ob-color-surface);
    border-bottom: 1px solid var(--_ob-color-border);
  }

  h2, h3, p {
    margin: 0;
  }

  h2, h3 {
    font-size: 0.92rem;
  }

  .eyebrow {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .count,
  .source span,
  .binding-select span {
    color: var(--_ob-color-text-muted);
    font-size: 0.72rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(10rem, 0.4fr) minmax(0, 1fr);
    min-height: 0;
  }

  .source-list {
    min-width: 0;
    overflow: auto;
    background: var(--_ob-color-surface);
    border-right: 1px solid var(--_ob-color-border);
  }

  .source {
    display: grid;
    width: 100%;
    gap: 0.2rem;
    padding: var(--_ob-space);
    text-align: left;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--_ob-color-border);
    cursor: pointer;
  }

  .source.selected {
    background: var(--_ob-color-background);
    box-shadow: inset 3px 0 var(--_ob-color-accent);
  }

  .source-detail {
    min-width: 0;
    overflow: auto;
    padding: var(--_ob-space);
  }

  .source-actions {
    display: flex;
    gap: 0.4rem;
  }

  button {
    min-height: 2rem;
    padding: 0.3rem 0.55rem;
    color: inherit;
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  button.danger {
    color: var(--_ob-color-danger);
  }

  dl {
    display: grid;
    gap: 0;
    margin: var(--_ob-space) 0;
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  dl div {
    display: grid;
    grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
    gap: var(--_ob-space);
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--_ob-color-border);
  }

  dl div:last-child {
    border-bottom: 0;
  }

  dt {
    color: var(--_ob-color-text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  code, pre {
    font-family: var(--_ob-font-mono);
    font-size: 0.75rem;
  }

  .content-preview {
    margin: var(--_ob-space) 0;
  }

  .content-preview summary {
    cursor: pointer;
  }

  .content-preview pre {
    max-height: 16rem;
    padding: var(--_ob-space);
    overflow: auto;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
  }

  .bindings {
    display: grid;
    gap: 0.55rem;
    margin-top: calc(var(--_ob-space) * 1.5);
  }

  .binding-list {
    display: grid;
    gap: 0.35rem;
  }

  .binding-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  .binding-row.selected {
    border-color: var(--_ob-color-accent);
  }

  .binding-select {
    display: grid;
    min-width: 0;
    gap: 0.16rem;
    text-align: left;
    background: transparent;
    border: 0;
  }

  .binding-select strong,
  .binding-select span,
  .binding-select code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .binding-remove {
    width: 2.2rem;
    border: 0;
    border-left: 1px solid var(--_ob-color-border);
    border-radius: 0;
  }

  .empty {
    align-self: start;
    padding: var(--_ob-space);
    color: var(--_ob-color-text-muted);
  }

  .empty.compact {
    padding: 0.4rem 0;
  }

  @container (max-width: 38rem) {
    /* One column: the source list sits above the detail, sized to its
       content up to a cap (it scrolls past that), and the detail keeps its
       own scroll. fit-content — not a plain auto row — because the list is
       a scroll container whose automatic minimum is zero: under a tight
       height an auto row would collapse it entirely. */
    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: fit-content(9rem) minmax(0, 1fr);
    }

    .source-list {
      border-right: 0;
      border-bottom: 1px solid var(--_ob-color-border);
    }
  }
`;
