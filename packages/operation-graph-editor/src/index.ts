import {
  type OperationGraph,
  type OperationGraphNode,
  type OperationGraphPatch,
} from "@openbindings/operation-graph-model";
import type { OperationGraphViewerElement } from "@openbindings/operation-graph-viewer";
import "@openbindings/operation-graph-viewer/define";
import {
  OpenBindingsElement,
  baseStyles,
  renderStatic,
} from "@openbindings/ui-core";

export const OPERATION_GRAPH_EDITOR_TAG = "ob-operation-graph-editor";

export interface OperationGraphPatchDetail {
  patches: OperationGraphPatch[];
  reason: string;
  requiresConfirmation: boolean;
}

export interface OperationGraphEditorEventMap {
  "ob-graph-patch": CustomEvent<OperationGraphPatchDetail>;
}

const nodeTypes = [
  "input",
  "output",
  "operation",
  "each",
  "buffer",
  "filter",
  "transform",
  "map",
  "combine",
  "exit",
] as const;

export class OperationGraphEditorElement extends OpenBindingsElement {
  #graph: OperationGraph | null = null;
  #selectedNodeKey: string | null = null;
  #operationKeys: string[] = [];

  get graph(): OperationGraph | null {
    return this.#graph;
  }

  set graph(value: OperationGraph | null) {
    if (value === this.#graph) return;
    this.#graph = value;
    this.requestRender();
  }

  get selectedNodeKey(): string | null {
    return this.#selectedNodeKey;
  }

  set selectedNodeKey(value: string | null) {
    const normalized = value?.trim() || null;
    if (normalized === this.#selectedNodeKey) return;
    this.#selectedNodeKey = normalized;
    this.requestRender();
  }

  get operationKeys(): readonly string[] {
    return this.#operationKeys;
  }

  set operationKeys(value: readonly string[]) {
    this.#operationKeys = [...new Set((value ?? []).filter(key => key.trim()))];
    this.requestRender();
  }

  protected override render(): void {
    const root = this.renderRoot;
    if (!root) return;
    const graph = this.#graph;
    const selected =
      graph && this.#selectedNodeKey
        ? graph.nodes[this.#selectedNodeKey]
        : undefined;

    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <section class="container" part="container" aria-label="Operation graph editor">
         <div class="viewer">
           <ob-operation-graph-viewer></ob-operation-graph-viewer>
         </div>
         <aside class="inspector" part="inspector">
           <header>
             <p class="eyebrow">Graph editor</p>
             <h2>${selected && this.#selectedNodeKey ? escapeHTML(this.#selectedNodeKey) : "Add a node"}</h2>
           </header>
           ${
             !graph
               ? `<p class="empty">Assign an operation graph to edit it.</p>`
               : selected && this.#selectedNodeKey
                 ? nodeFormTemplate(
                     this.#selectedNodeKey,
                     selected,
                     graph,
                     this.#operationKeys,
                   )
                 : addNodeTemplate(this.#operationKeys)
           }
           ${graph ? edgeEditorTemplate(graph) : ""}
           <p class="edit-status" role="status" aria-live="polite"></p>
         </aside>
       </section>`,
    );
    const viewer = root.querySelector(
      "ob-operation-graph-viewer",
    ) as OperationGraphViewerElement | null;
    if (viewer) {
      viewer.graph = graph;
      viewer.selectedNodeKey = this.#selectedNodeKey;
    }
    root.addEventListener(
      "ob-graph-node-select",
      event => {
        if (!(event instanceof CustomEvent)) return;
        const nodeKey = (event.detail as { nodeKey?: unknown }).nodeKey;
        if (typeof nodeKey !== "string") return;
        this.#selectedNodeKey = nodeKey;
        this.requestRender();
      },
      { once: true },
    );

    root
      .querySelector<HTMLFormElement>("#add-node-form")
      ?.addEventListener("submit", event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const nodeKey = String(form.get("nodeKey") ?? "").trim();
        const type = String(form.get("type") ?? "").trim();
        if (!nodeKey || !type) return;
        const node = newNodeFromForm(form, type);
        if (!node.ok) {
          this.#showStatus(node.error);
          return;
        }
        this.#emitPatch(
          [
            {
              type: "add-node",
              nodeKey,
              node: node.value,
            },
          ],
          `Add node ${nodeKey}`,
          false,
        );
      });
    const addType = root.querySelector<HTMLSelectElement>(
      '#add-node-form select[name="type"]',
    );
    if (addType) {
      const update = () => updateAddNodeFields(root, addType.value);
      addType.addEventListener("change", update);
      update();
    }

    for (const control of root.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[data-node-field]")) {
      control.addEventListener("change", () => {
        if (!graph || !selected || !this.#selectedNodeKey) return;
        const field = control.dataset.nodeField;
        if (!field) return;
        if (field === "type") {
          const type = control.value;
          if (!type || type === selected.type) return;
          this.#emitPatch(
            [
              {
                type: "set-node",
                nodeKey: this.#selectedNodeKey,
                node: { type },
              },
            ],
            `Change ${this.#selectedNodeKey} from ${selected.type} to ${type}; type-specific fields will be removed`,
            Object.keys(selected).length > 1,
          );
          return;
        }
        const next = structuredClone(selected);
        const parsed = parseNodeField(control, field);
        if (!parsed.ok) {
          this.#showStatus(parsed.error);
          return;
        }
        if (parsed.value === undefined) {
          delete (next as unknown as Record<string, unknown>)[field];
        } else {
          (next as unknown as Record<string, unknown>)[field] = parsed.value;
        }
        this.#emitPatch(
          [
            {
              type: "set-node",
              nodeKey: this.#selectedNodeKey,
              node: next,
            },
          ],
          `Update ${this.#selectedNodeKey}.${field}`,
          false,
        );
      });
    }

    root
      .querySelector<HTMLButtonElement>("[data-remove-node]")
      ?.addEventListener("click", () => {
        if (!graph || !this.#selectedNodeKey) return;
        const incident = graph.edges.filter(
          edge =>
            edge.from === this.#selectedNodeKey ||
            edge.to === this.#selectedNodeKey,
        ).length;
        this.#emitPatch(
          [
            {
              type: "remove-node",
              nodeKey: this.#selectedNodeKey,
              removeIncidentEdges: incident > 0,
            },
          ],
          incident
            ? `Remove ${this.#selectedNodeKey} and ${incident} incident edge${incident === 1 ? "" : "s"}`
            : `Remove ${this.#selectedNodeKey}`,
          incident > 0,
        );
      });

    root
      .querySelector<HTMLFormElement>("#add-edge-form")
      ?.addEventListener("submit", event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const from = String(form.get("from") ?? "");
        const to = String(form.get("to") ?? "");
        if (!from || !to) return;
        this.#emitPatch(
          [{ type: "add-edge", edge: { from, to } }],
          `Connect ${from} to ${to}`,
          false,
        );
      });
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-remove-edge]",
    )) {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.removeEdge);
        if (!Number.isInteger(index)) return;
        this.#emitPatch(
          [{ type: "remove-edge", index }],
          `Remove edge ${index + 1}`,
          false,
        );
      });
    }
  }

  #emitPatch(
    patches: OperationGraphPatch[],
    reason: string,
    requiresConfirmation: boolean,
  ): void {
    this.emit("ob-graph-patch", {
      patches,
      reason,
      requiresConfirmation,
    });
  }

  #showStatus(message: string): void {
    const status = this.renderRoot?.querySelector<HTMLElement>(".edit-status");
    if (status) status.textContent = message;
  }
}

function addNodeTemplate(operationKeys: string[]): string {
  return `<form id="add-node-form" class="form-section">
    <label>Node key<input name="nodeKey" required pattern=".*\\S.*" autocomplete="off"></label>
    <label>Node type<select name="type">${nodeTypes
      .map(type => `<option value="${type}">${type}</option>`)
      .join("")}</select></label>
    <label data-add-types="operation each">Operation <select name="operation">
      <option value="">Required for operation and each nodes</option>
      ${operationKeys
        .map(
          key =>
            `<option value="${escapeHTML(key)}">${escapeHTML(key)}</option>`,
        )
        .join("")}
    </select></label>
    <label data-add-types="transform map filter">Transform or expression
      <textarea name="transform" spellcheck="false" placeholder="Required for transform and map nodes; optional expression form for filter"></textarea>
    </label>
    <label data-add-types="filter">Filter schema
      <textarea name="schema" spellcheck="false" placeholder="JSON Schema alternative for a filter node"></textarea>
    </label>
    <button class="primary" type="submit">Add node</button>
  </form>`;
}

function nodeFormTemplate(
  nodeKey: string,
  node: OperationGraphNode,
  graph: OperationGraph,
  operationKeys: string[],
): string {
  const field = (
    key: keyof OperationGraphNode,
    label: string,
    type: "text" | "number" = "text",
  ) => `<label>${label}<input data-node-field="${key}" type="${type}" value="${escapeHTML(String(node[key] ?? ""))}"></label>`;
  const jsonField = (key: "schema" | "until" | "through", label: string) =>
    `<label>${label}<textarea data-node-field="${key}" spellcheck="false" placeholder="JSON value">${node[key] === undefined ? "" : escapeHTML(JSON.stringify(node[key], null, 2))}</textarea></label>`;
  const operationOptions = [
    ...(node.operation && !operationKeys.includes(node.operation)
      ? [node.operation]
      : []),
    ...operationKeys,
  ];
  return `<div class="form-section">
    <label>Node type<select data-node-field="type" disabled aria-describedby="node-type-note">${nodeTypes
      .map(
        type =>
          `<option value="${type}"${type === node.type ? " selected" : ""}>${type}</option>`,
      )
      .join("")}</select><small id="node-type-note">Replace the node explicitly to change its type.</small></label>
    ${
      node.type === "operation" || node.type === "each"
        ? `<label>Operation<select data-node-field="operation">
             <option value="">Choose an operation</option>
             ${operationOptions
               .map(
                 key =>
                   `<option value="${escapeHTML(key)}"${key === node.operation ? " selected" : ""}>${escapeHTML(key)}</option>`,
               )
               .join("")}
           </select></label>`
        : ""
    }
    ${
      node.type !== "input" && node.type !== "output"
        ? `<label>Error route<select data-node-field="onError">
             <option value="">No error route</option>
             ${Object.keys(graph.nodes)
               .filter(key => key !== nodeKey)
               .map(
                 key =>
                   `<option value="${escapeHTML(key)}"${key === node.onError ? " selected" : ""}>${escapeHTML(key)}</option>`,
               )
               .join("")}
           </select></label>`
        : ""
    }
    ${node.type === "operation" || node.type === "each" ? field("timeout", "Timeout (ms)", "number") : ""}
    ${node.type === "each" ? field("maxIterations", "Maximum iterations", "number") : ""}
    ${node.type === "buffer" ? field("limit", "Buffer limit", "number") : ""}
    ${node.type === "buffer" ? jsonField("until", "Until schema") + jsonField("through", "Through schema") : ""}
    ${node.type === "filter" ? jsonField("schema", "Filter schema") : ""}
    ${
      node.type === "filter" ||
      node.type === "transform" ||
      node.type === "map"
        ? `<label>Transform<textarea data-node-field="transform" spellcheck="false">${escapeHTML(node.transform ?? "")}</textarea></label>`
        : ""
    }
    ${
      node.type === "exit"
        ? `<label class="checkbox"><input data-node-field="error" type="checkbox"${node.error ? " checked" : ""}> Exit with terminal error</label>`
        : ""
    }
    <button class="danger" type="button" data-remove-node>Remove node</button>
  </div>`;
}

function edgeEditorTemplate(graph: OperationGraph): string {
  const keys = Object.keys(graph.nodes);
  const options = keys
    .map(key => `<option value="${escapeHTML(key)}">${escapeHTML(key)}</option>`)
    .join("");
  return `<section class="edge-editor">
    <h3>Edges</h3>
    <form id="add-edge-form">
      <select name="from" aria-label="Edge source" required><option value="">From…</option>${options}</select>
      <span aria-hidden="true">→</span>
      <select name="to" aria-label="Edge destination" required><option value="">To…</option>${options}</select>
      <button type="submit">Add</button>
    </form>
    <ol>
      ${graph.edges
        .map(
          (edge, index) =>
            `<li><code>${escapeHTML(edge.from)} → ${escapeHTML(edge.to)}</code><button type="button" data-remove-edge="${index}" aria-label="Remove edge ${escapeHTML(edge.from)} to ${escapeHTML(edge.to)}">×</button></li>`,
        )
        .join("")}
    </ol>
  </section>`;
}

function parseNodeField(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  field: string,
):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return { ok: true, value: control.checked };
  }
  const raw = control.value.trim();
  if (!raw) return { ok: true, value: undefined };
  if (field === "timeout" || field === "maxIterations" || field === "limit") {
    const value = Number(raw);
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, error: `${field} must be a finite number.` };
  }
  if (field === "schema" || field === "until" || field === "through") {
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch (error) {
      return {
        ok: false,
        error: `${field} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { ok: true, value: raw };
}

function newNodeFromForm(
  form: FormData,
  type: string,
):
  | { ok: true; value: OperationGraphNode }
  | { ok: false; error: string } {
  const operation = String(form.get("operation") ?? "").trim();
  const transform = String(form.get("transform") ?? "").trim();
  const schemaText = String(form.get("schema") ?? "").trim();
  if ((type === "operation" || type === "each") && !operation) {
    return { ok: false, error: `${type} nodes require an operation.` };
  }
  if ((type === "transform" || type === "map") && !transform) {
    return { ok: false, error: `${type} nodes require a transform expression.` };
  }
  if (type === "filter" && !transform && !schemaText) {
    return {
      ok: false,
      error: "filter nodes require either an expression or a JSON schema.",
    };
  }
  if (type === "filter" && transform && schemaText) {
    return {
      ok: false,
      error: "filter nodes use either expression form or schema form, not both.",
    };
  }
  const node: OperationGraphNode = { type };
  if (operation) node.operation = operation;
  if (transform) node.transform = transform;
  if (schemaText) {
    try {
      node.schema = JSON.parse(schemaText) as unknown;
    } catch (error) {
      return {
        ok: false,
        error: `filter schema must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { ok: true, value: node };
}

function updateAddNodeFields(root: ShadowRoot, type: string): void {
  for (const field of root.querySelectorAll<HTMLElement>("[data-add-types]")) {
    field.hidden = !(field.dataset.addTypes ?? "").split(" ").includes(type);
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

export interface OperationGraphEditorElement {
  addEventListener<K extends keyof OperationGraphEditorEventMap>(
    type: K,
    listener: (
      this: OperationGraphEditorElement,
      event: OperationGraphEditorEventMap[K],
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
    "ob-operation-graph-editor": OperationGraphEditorElement;
  }
}

const styles = `
  :host {
    display: block;
    min-width: 0;
    min-height: 0;
  }

  .container {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(16rem, 21rem);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  .viewer,
  ob-operation-graph-viewer {
    display: block;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  ob-operation-graph-viewer::part(container) {
    border: 0;
    border-radius: 0;
  }

  .inspector {
    min-width: 0;
    overflow: auto;
    padding: var(--ob-space);
    border-left: 1px solid var(--ob-color-border);
  }

  header {
    margin-bottom: var(--ob-space);
  }

  h2, h3, p {
    margin: 0;
  }

  h2, h3 {
    font-size: 0.92rem;
  }

  .eyebrow {
    color: var(--ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .form-section {
    display: grid;
    gap: 0.65rem;
  }

  label {
    display: grid;
    gap: 0.25rem;
    color: var(--ob-color-text-muted);
    font-size: 0.72rem;
  }

  label.checkbox {
    display: flex;
    align-items: center;
  }

  input,
  select,
  textarea,
  button {
    min-width: 0;
    min-height: 2rem;
    padding: 0.35rem 0.5rem;
    color: var(--ob-color-text);
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: calc(var(--ob-radius) * 0.65);
  }

  textarea {
    min-height: 4rem;
    resize: vertical;
    font-family: var(--ob-font-mono);
    font-size: 0.72rem;
  }

  button {
    cursor: pointer;
  }

  button.primary {
    color: var(--ob-color-accent-contrast);
    background: var(--ob-color-accent);
    border-color: var(--ob-color-accent);
  }

  button.danger {
    color: var(--ob-color-danger);
  }

  .edge-editor {
    display: grid;
    gap: 0.55rem;
    margin-top: calc(var(--ob-space) * 1.5);
    padding-top: var(--ob-space);
    border-top: 1px solid var(--ob-color-border);
  }

  .edge-editor form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
    gap: 0.3rem;
    align-items: center;
  }

  .edge-editor ol {
    display: grid;
    gap: 0.25rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .edge-editor li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem;
    align-items: center;
    padding: 0.25rem 0.4rem;
    background: var(--ob-color-surface);
    border-radius: calc(var(--ob-radius) * 0.5);
  }

  .edge-editor code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--ob-font-mono);
    font-size: 0.68rem;
  }

  .edge-editor li button {
    width: 2rem;
    padding: 0;
    color: var(--ob-color-danger);
  }

  .edit-status,
  .empty {
    margin-top: var(--ob-space);
    color: var(--ob-color-text-muted);
    font-size: 0.72rem;
  }

  @media (max-width: 48rem) {
    .container {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(24rem, 1fr) auto;
      overflow: auto;
    }

    .inspector {
      overflow: visible;
      border-top: 1px solid var(--ob-color-border);
      border-left: 0;
    }
  }
`;
