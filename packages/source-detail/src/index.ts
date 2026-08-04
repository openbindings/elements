import type { OBInterface } from "@openbindings/sdk";
import type { JSONEditorElement } from "@openbindings/json-editor";
import {
  OpenBindingsElement,
  type Refs,
  baseStyles,
  formatJSON,
  reconcile,
  setTextIfChanged,
} from "@openbindings/ui-core";

export const SOURCE_DETAIL_TAG = "ob-source-detail";

export interface SourceKeyDetail {
  sourceKey: string;
}

export interface SourceBindingDetail {
  bindingKey: string;
  sourceKey: string;
  operationKey: string;
}

/**
 * The subset of an inspectSource result this element renders. Hosts assign
 * whatever the contract returned; unknown extra fields are ignored.
 */
export interface SourceInspection {
  targets?: Array<{
    ref?: string;
    operationKey?: string;
    operation?: { description?: string };
  }>;
  exhaustive?: boolean;
  limitation?: { code?: string; message?: string };
}

export interface SourceDetailEventMap {
  "ob-source-pull": CustomEvent<SourceKeyDetail>;
  "ob-source-remove": CustomEvent<SourceKeyDetail>;
  "ob-source-inspect": CustomEvent<SourceKeyDetail>;
  "ob-binding-select": CustomEvent<SourceBindingDetail>;
  "ob-binding-remove": CustomEvent<SourceBindingDetail>;
}

/**
 * One source's workspace view (rev 16): the facts (binding spec, location,
 * embedded content), the verbs (Pull, Inspect, Remove — emitted as intents;
 * the host commits them through pullSource / inspectSource / removeSource),
 * the bindings derived from this source, and the host-assigned inspection
 * report. Sibling of ob-operation-detail; knows nothing about transport.
 */
export class SourceDetailElement extends OpenBindingsElement {
  #obi: OBInterface | null = null;
  #sourceKey: string | null = null;
  #inspection: SourceInspection | null = null;
  #pulling = false;
  // The preview editor only receives text when the content identity changes,
  // so re-renders (selection, inspection arrival) never reset its scroll.
  #previewFor: unknown = undefined;

  get obi(): OBInterface | null {
    return this.#obi;
  }

  set obi(value: OBInterface | null) {
    if (value === this.#obi) return;
    this.#obi = value;
    this.requestRender();
  }

  get sourceKey(): string | null {
    return this.#sourceKey;
  }

  set sourceKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#sourceKey) return;
    this.#sourceKey = normalized;
    // A different source is a different inspection subject.
    this.#inspection = null;
    this.requestRender();
  }

  /** Host-assigned inspectSource result; null clears the report. */
  get inspection(): SourceInspection | null {
    return this.#inspection;
  }

  set inspection(value: SourceInspection | null) {
    if (value === this.#inspection) return;
    this.#inspection = value;
    this.requestRender();
  }

  /** True while the host has a pull in flight for this source. */
  get pulling(): boolean {
    return this.#pulling;
  }

  set pulling(value: boolean) {
    const next = Boolean(value);
    if (next === this.#pulling) return;
    this.#pulling = next;
    this.requestRender();
  }

  protected override bind(refs: Refs): void {
    refs.require(".pull").addEventListener("click", () => {
      if (this.#sourceKey) {
        this.emit<SourceKeyDetail>("ob-source-pull", {
          sourceKey: this.#sourceKey,
        });
      }
    });
    refs.require(".inspect").addEventListener("click", () => {
      if (this.#sourceKey) {
        this.emit<SourceKeyDetail>("ob-source-inspect", {
          sourceKey: this.#sourceKey,
        });
      }
    });
    refs.require(".remove").addEventListener("click", () => {
      if (this.#sourceKey) {
        this.emit<SourceKeyDetail>("ob-source-remove", {
          sourceKey: this.#sourceKey,
        });
      }
    });

    // One delegated listener for the bindings list: row buttons navigate,
    // the × emits the unbind intent.
    refs.require(".binding-list").addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const remove = target?.closest<HTMLElement>("[data-binding-remove]");
      const row = target?.closest<HTMLElement>("[data-binding-key]");
      const detail = row ? this.#bindingDetail(row) : null;
      if (!detail) return;
      if (remove) this.emit<SourceBindingDetail>("ob-binding-remove", detail);
      else this.emit<SourceBindingDetail>("ob-binding-select", detail);
    });
  }

  #bindingDetail(row: HTMLElement): SourceBindingDetail | null {
    const bindingKey = row.dataset.bindingKey;
    const operationKey = row.dataset.operationKey;
    return bindingKey && operationKey && this.#sourceKey
      ? { bindingKey, operationKey, sourceKey: this.#sourceKey }
      : null;
  }

  protected override render(): void {
    const refs = this.shell(SHELL, baseStyles, styles);
    if (!refs) return;

    const source =
      this.#obi && this.#sourceKey
        ? this.#obi.sources?.[this.#sourceKey]
        : undefined;
    const empty = refs.require(".empty");
    const content = refs.require<HTMLElement>(".content");

    if (!this.#obi || !this.#sourceKey || !source) {
      empty.hidden = false;
      setTextIfChanged(
        empty,
        this.#obi
          ? "Select a source to inspect its facts and bindings."
          : "Assign an OBI document and source key.",
      );
      content.hidden = true;
      this.#previewFor = undefined;
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    setTextIfChanged(refs.require("h2"), this.#sourceKey);

    const pull = refs.require<HTMLButtonElement>(".pull");
    pull.disabled = !source.location || this.#pulling;
    setTextIfChanged(pull, this.#pulling ? "Pulling…" : "Pull");
    pull.title = source.location
      ? "Pull the source's current artifact from its location"
      : "This source is embedded only — there is no location to pull from";

    setTextIfChanged(refs.require(".spec"), source.bindingSpec);
    setTextIfChanged(
      refs.require(".location"),
      source.location ?? "Embedded only",
    );
    setTextIfChanged(
      refs.require(".presence"),
      source.content === undefined
        ? "Not embedded"
        : typeof source.content === "string"
          ? "Embedded source text"
          : "Embedded parsed artifact",
    );

    this.#renderPreview(refs, source.content);
    this.#renderInspection(refs);
    this.#renderBindings(refs);
  }

  #renderPreview(refs: Refs, content: unknown): void {
    const details = refs.require<HTMLDetailsElement>(".content-preview");
    details.hidden = content === undefined;
    if (content === undefined) {
      this.#previewFor = undefined;
      return;
    }
    if (this.#previewFor === content) return;
    this.#previewFor = content;
    const editor = refs.require<JSONEditorElement>(".preview-editor");
    const note = refs.require(".preview-note");
    const { text, language, truncated } = previewText(content);
    editor.readOnly = true;
    editor.language = language;
    editor.text = text;
    note.hidden = !truncated;
  }

  #renderInspection(refs: Refs): void {
    const section = refs.require<HTMLElement>(".inspection");
    const inspection = this.#inspection;
    section.hidden = !inspection;
    if (!inspection) return;

    const targets = inspection.targets ?? [];
    setTextIfChanged(
      refs.require(".inspection-count"),
      `${targets.length} bindable target${targets.length === 1 ? "" : "s"}`,
    );
    const limitation = refs.require(".inspection-limitation");
    const limited = inspection.exhaustive === false;
    limitation.hidden = !limited;
    setTextIfChanged(
      limitation,
      limited
        ? `Not exhaustive: ${inspection.limitation?.message ?? inspection.limitation?.code ?? "additional targets may exist."}`
        : "",
    );

    reconcile(refs.require(".target-list"), targets, {
      key: (target, index) => `${index}:${target.ref ?? ""}`,
      create: () => {
        const item = document.createElement("li");
        const ref = document.createElement("code");
        const operation = document.createElement("span");
        item.append(ref, operation);
        return item;
      },
      update: (node, target) => {
        const ref = node.querySelector("code");
        if (ref) setTextIfChanged(ref, target.ref ?? "whole source");
        const operation = node.querySelector("span");
        if (operation) {
          setTextIfChanged(
            operation,
            target.operationKey ?? target.operation?.description ?? "",
          );
        }
      },
    });
  }

  #renderBindings(refs: Refs): void {
    const bindings = Object.entries(this.#obi?.bindings ?? {}).filter(
      ([, binding]) => binding.source === this.#sourceKey,
    );
    refs.require(".bindings-empty").hidden = bindings.length > 0;
    reconcile(refs.require(".binding-list"), bindings, {
      key: ([key]) => key,
      create: () => {
        const row = document.createElement("li");
        row.setAttribute("part", "binding");
        const select = document.createElement("button");
        select.type = "button";
        select.className = "binding-select";
        const key = document.createElement("strong");
        const operation = document.createElement("span");
        const ref = document.createElement("code");
        select.append(key, operation, ref);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "binding-remove danger";
        remove.dataset.bindingRemove = "";
        remove.textContent = "×";
        row.append(select, remove);
        return row;
      },
      update: (row, [key, binding]) => {
        row.dataset.bindingKey = key;
        row.dataset.operationKey = binding.operation;
        const strong = row.querySelector("strong");
        if (strong) setTextIfChanged(strong, key);
        const operation = row.querySelector("span");
        if (operation) setTextIfChanged(operation, binding.operation);
        const ref = row.querySelector("code");
        if (ref) setTextIfChanged(ref, binding.ref ?? "whole source");
        const remove = row.querySelector<HTMLButtonElement>(".binding-remove");
        if (remove) {
          remove.setAttribute("aria-label", `Remove binding ${key}`);
          remove.title = `Remove binding ${key}`;
        }
      },
    });
  }
}

const MAX_PREVIEW_CHARACTERS = 262_144;

function previewText(content: unknown): {
  text: string;
  language: "json" | "yaml";
  truncated: boolean;
} {
  let text: string;
  let language: "json" | "yaml" = "json";
  if (typeof content === "string") {
    text = content;
    try {
      JSON.parse(content);
    } catch {
      // Raw source text that is not JSON is overwhelmingly YAML in this
      // domain (OpenAPI/AsyncAPI artifacts); YAML highlighting also tolerates
      // plain text.
      language = "yaml";
    }
  } else {
    text = formatJSON(content);
  }
  if (text.length <= MAX_PREVIEW_CHARACTERS) {
    return { text, language, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_PREVIEW_CHARACTERS)}\n…`,
    language,
    truncated: true,
  };
}

const SHELL = `
  <section class="container" part="container" aria-label="Source detail">
    <p class="empty" part="empty"></p>
    <div class="content" hidden>
      <header part="header">
        <div>
          <p class="eyebrow">Source</p>
        <h2></h2>
        </div>
        <div class="verbs" part="verbs">
          <button class="pull" type="button">Pull</button>
          <button class="inspect" type="button" title="List the bindable targets this source offers">Inspect</button>
          <button class="remove danger" type="button">Remove</button>
        </div>
      </header>
      <dl part="facts">
        <div><dt>Binding specification</dt><dd><code class="spec"></code></dd></div>
        <div><dt>Location</dt><dd><code class="location"></code></dd></div>
        <div><dt>Content</dt><dd class="presence"></dd></div>
      </dl>
      <details class="content-preview" part="content-preview" hidden>
        <summary>Embedded content</summary>
        <ob-json-editor class="preview-editor" part="preview-editor"></ob-json-editor>
        <p class="preview-note" hidden>
          Preview truncated at 256 KiB. The document's source value is unchanged.
        </p>
      </details>
      <section class="inspection" part="inspection" hidden>
        <h3>Inspection</h3>
        <p class="inspection-count"></p>
        <p class="inspection-limitation" hidden></p>
        <ul class="target-list" part="target-list"></ul>
      </section>
      <section class="bindings" part="bindings">
        <h3>Bindings from this source</h3>
        <p class="bindings-empty empty compact" hidden>No bindings reference this source.</p>
        <ul class="binding-list" part="binding-list" aria-label="Bindings from this source"></ul>
      </section>
    </div>
  </section>
`;

export interface SourceDetailElement {
  addEventListener<K extends keyof SourceDetailEventMap>(
    type: K,
    listener: (
      this: SourceDetailElement,
      event: SourceDetailEventMap[K],
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
    "ob-source-detail": SourceDetailElement;
  }
}

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;
  }

  .container {
    height: 100%;
    min-height: 0;
    overflow: auto;
    padding: calc(var(--_ob-space) * 1.25);
    background: var(--_ob-color-background);
    border: 1px solid var(--_ob-color-border);
    border-radius: var(--_ob-radius);
  }

  .content[hidden],
  .content-preview[hidden],
  .inspection[hidden],
  .bindings-empty[hidden],
  .preview-note[hidden],
  .inspection-limitation[hidden] {
    display: none;
  }

  header {
    display: flex;
    gap: var(--_ob-space);
    align-items: center;
    justify-content: space-between;
  }

  h2, h3, p, dl {
    margin: 0;
  }

  h2 {
    overflow-wrap: anywhere;
    font-size: 1rem;
    font-family: var(--_ob-font-mono);
  }

  h3 {
    font-size: 0.8rem;
  }

  .eyebrow {
    color: var(--_ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .verbs {
    display: flex;
    flex-shrink: 0;
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

  button:hover {
    background: var(--_ob-color-surface);
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

  code {
    font-family: var(--_ob-font-mono);
    font-size: 0.75rem;
  }

  .content-preview {
    margin: var(--_ob-space) 0;
  }

  .content-preview summary {
    cursor: pointer;
  }

  .preview-editor {
    display: block;
    max-height: 22rem;
    margin-top: 0.5rem;
  }

  .preview-note,
  .inspection-count,
  .inspection-limitation {
    color: var(--_ob-color-text-muted);
    font-size: 0.78rem;
  }

  .inspection,
  .bindings {
    display: grid;
    gap: 0.55rem;
    margin-top: calc(var(--_ob-space) * 1.5);
  }

  .target-list,
  .binding-list {
    display: grid;
    gap: 0.35rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .target-list li {
    display: grid;
    gap: 0.16rem;
    padding: 0.45rem 0.6rem;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  .target-list span {
    color: var(--_ob-color-text-muted);
    font-size: 0.75rem;
  }

  .target-list span:empty {
    display: none;
  }

  .binding-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    background: var(--_ob-color-surface);
    border: 1px solid var(--_ob-color-border);
    border-radius: calc(var(--_ob-radius) * 0.65);
  }

  .binding-select {
    display: grid;
    min-width: 0;
    min-height: 0;
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

  .binding-select span {
    color: var(--_ob-color-text-muted);
    font-size: 0.75rem;
  }

  .binding-remove {
    width: 2.2rem;
    min-height: 0;
    border: 0;
    border-left: 1px solid var(--_ob-color-border);
    border-radius: 0;
  }

  .empty {
    color: var(--_ob-color-text-muted);
  }

  .empty.compact {
    font-size: 0.8rem;
  }
`;
