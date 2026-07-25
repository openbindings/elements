import {
  diagnoseOperationGraph,
  layoutOperationGraph,
  type OperationGraph,
  type OperationGraphEdge,
} from "@openbindings/operation-graph-model";
import {
  OpenBindingsElement,
  baseStyles,
  renderStatic,
} from "@openbindings/ui-core";

export const OPERATION_GRAPH_VIEWER_TAG = "ob-operation-graph-viewer";

export interface GraphNodeSelectDetail {
  nodeKey: string;
}

export interface GraphEdgeSelectDetail {
  edgeIndex: number;
  edge: OperationGraphEdge;
}

export interface OperationGraphViewerEventMap {
  "ob-graph-node-select": CustomEvent<GraphNodeSelectDetail>;
  "ob-graph-edge-select": CustomEvent<GraphEdgeSelectDetail>;
}

export class OperationGraphViewerElement extends OpenBindingsElement {
  #graph: OperationGraph | null = null;
  #selectedNodeKey: string | null = null;
  #selectedEdgeIndex: number | null = null;
  #zoom = 1;

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

  get selectedEdgeIndex(): number | null {
    return this.#selectedEdgeIndex;
  }

  set selectedEdgeIndex(value: number | null) {
    const normalized =
      value === null || !Number.isInteger(value) || value < 0 ? null : value;
    if (normalized === this.#selectedEdgeIndex) return;
    this.#selectedEdgeIndex = normalized;
    this.requestRender();
  }

  get zoom(): number {
    return this.#zoom;
  }

  set zoom(value: number) {
    if (!Number.isFinite(value)) throw new TypeError("zoom must be finite");
    const normalized = Math.min(2, Math.max(0.4, value));
    if (normalized === this.#zoom) return;
    this.#zoom = normalized;
    this.requestRender();
  }

  protected override render(): void {
    const root = this.renderRoot;
    if (!root) return;
    const graph = this.#graph;
    if (!graph) {
      renderStatic(
        root,
        `<style>${baseStyles}${styles}</style>
         <section class="container" part="container" aria-label="Operation graph viewer">
           ${toolbarTemplate(this.#zoom)}
           <p class="empty" part="empty">Assign an operation graph to view it.</p>
         </section>`,
      );
      this.#attachControls();
      return;
    }

    const layout = layoutOperationGraph(graph);
    const diagnostics = diagnoseOperationGraph(graph);
    const nodes = Object.entries(graph.nodes)
      .map(([key, node]) => {
        const position = layout.positions[key] ?? { x: 0, y: 0 };
        const selected = key === this.#selectedNodeKey;
        return `<button
          class="node node-${safeClass(node.type)}${selected ? " selected" : ""}"
          part="node node-${safeClass(node.type)}${selected ? " selected-node" : ""}"
          type="button"
          data-node-key="${escapeHTML(key)}"
          style="left:${position.x}px;top:${position.y}px;width:${layout.nodeWidth}px;height:${layout.nodeHeight}px"
          aria-pressed="${selected}"
        >
          <span class="node-type">${escapeHTML(node.type)}</span>
          <strong>${escapeHTML(key)}</strong>
          ${nodeSubtitle(node)}
        </button>`;
      })
      .join("");
    const edges = graph.edges
      .map((edge, index) => edgeTemplate(graph, edge, index, layout, index === this.#selectedEdgeIndex))
      .join("");
    const diagnosticsTemplate = diagnostics.length
      ? `<details class="diagnostics" part="diagnostics">
           <summary>${diagnostics.length} structural note${diagnostics.length === 1 ? "" : "s"}</summary>
           <ul>${diagnostics
             .map(
               item =>
                 `<li data-severity="${item.severity}"><code>${escapeHTML(item.path || "/")}</code> ${escapeHTML(item.message)}</li>`,
             )
             .join("")}</ul>
         </details>`
      : `<p class="diagnostics-clear">No structural display issues.</p>`;

    renderStatic(
      root,
      `<style>${baseStyles}${styles}</style>
       <section class="container" part="container" aria-label="Operation graph viewer">
         ${toolbarTemplate(this.#zoom)}
         <div class="viewport" part="viewport" tabindex="0" aria-label="Graph canvas">
           <div class="scaled-canvas" style="width:${layout.width * this.#zoom}px;height:${layout.height * this.#zoom}px">
             <div class="surface" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${this.#zoom})">
               <svg width="${layout.width}" height="${layout.height}" aria-hidden="true">
                 <defs>
                   <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                     <path d="M 0 0 L 10 5 L 0 10 z"></path>
                   </marker>
                 </defs>
                 ${edges}
               </svg>
               ${nodes}
             </div>
           </div>
         </div>
         <footer>${diagnosticsTemplate}</footer>
       </section>`,
    );
    for (const node of root.querySelectorAll<HTMLButtonElement>("[data-node-key]")) {
      node.addEventListener("click", () => {
        const nodeKey = node.dataset.nodeKey;
        if (nodeKey) this.emit("ob-graph-node-select", { nodeKey });
      });
    }
    for (const edge of root.querySelectorAll<SVGPathElement>("[data-edge-index]")) {
      edge.addEventListener("click", () => {
        const index = Number(edge.dataset.edgeIndex);
        const value = graph.edges[index];
        if (value) {
          this.emit("ob-graph-edge-select", { edgeIndex: index, edge: value });
        }
      });
    }
    this.#attachControls();
  }

  #attachControls(): void {
    const root = this.renderRoot;
    root
      ?.querySelector<HTMLButtonElement>('[data-zoom="out"]')
      ?.addEventListener("click", () => {
        this.zoom = this.#zoom - 0.1;
      });
    root
      ?.querySelector<HTMLButtonElement>('[data-zoom="in"]')
      ?.addEventListener("click", () => {
        this.zoom = this.#zoom + 0.1;
      });
    root
      ?.querySelector<HTMLButtonElement>('[data-zoom="fit"]')
      ?.addEventListener("click", () => {
        const viewport = root.querySelector<HTMLElement>(".viewport");
        if (!viewport || !this.#graph) return;
        const layout = layoutOperationGraph(this.#graph);
        const availableWidth = Math.max(1, viewport.clientWidth - 24);
        const availableHeight = Math.max(1, viewport.clientHeight - 24);
        this.zoom = Math.min(
          1,
          availableWidth / layout.width,
          availableHeight / layout.height,
        );
        queueMicrotask(() => {
          const nextViewport =
            this.renderRoot?.querySelector<HTMLElement>(".viewport");
          if (nextViewport) {
            nextViewport.scrollLeft = 0;
            nextViewport.scrollTop = 0;
          }
        });
      });
  }
}

function toolbarTemplate(zoom: number): string {
  return `<header class="toolbar" part="toolbar">
    <div>
      <p class="eyebrow">Operation graph</p>
      <strong>Flow</strong>
    </div>
    <div class="zoom-controls">
      <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
      <span>${Math.round(zoom * 100)}%</span>
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="fit">Fit</button>
    </div>
  </header>`;
}

function edgeTemplate(
  graph: OperationGraph,
  edge: OperationGraphEdge,
  index: number,
  layout: ReturnType<typeof layoutOperationGraph>,
  selected: boolean,
): string {
  const from = layout.positions[edge.from];
  const to = layout.positions[edge.to];
  if (!from || !to) return "";
  const startX = from.x + layout.nodeWidth;
  const startY = from.y + layout.nodeHeight / 2;
  const endX = to.x;
  const endY = to.y + layout.nodeHeight / 2;
  const bend = Math.max(36, Math.abs(endX - startX) * 0.46);
  const path = `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  const label = `${edge.from} to ${edge.to}`;
  return `<g class="edge${selected ? " selected" : ""}">
    <path class="edge-line" d="${path}" marker-end="url(#arrow)"></path>
    <path class="edge-target" data-edge-index="${index}" d="${path}" tabindex="0" role="button" aria-label="${escapeHTML(label)}"></path>
  </g>`;
}

function nodeSubtitle(node: OperationGraph["nodes"][string]): string {
  const value =
    node.operation ??
    node.transform ??
    (node.limit !== undefined ? `limit ${node.limit}` : "");
  return value
    ? `<span class="node-subtitle">${escapeHTML(String(value))}</span>`
    : "";
}

function safeClass(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown";
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export interface OperationGraphViewerElement {
  addEventListener<K extends keyof OperationGraphViewerEventMap>(
    type: K,
    listener: (
      this: OperationGraphViewerElement,
      event: OperationGraphViewerEventMap[K],
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
    "ob-operation-graph-viewer": OperationGraphViewerElement;
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
    grid-template-rows: auto minmax(12rem, 1fr) auto;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: var(--ob-radius);
  }

  .toolbar {
    display: flex;
    gap: var(--ob-space);
    align-items: center;
    justify-content: space-between;
    min-height: 3rem;
    padding: 0.55rem var(--ob-space);
    background: var(--ob-color-surface);
    border-bottom: 1px solid var(--ob-color-border);
  }

  .toolbar p,
  footer p {
    margin: 0;
  }

  .eyebrow {
    color: var(--ob-color-text-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .zoom-controls {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }

  .zoom-controls button {
    min-width: 2rem;
    min-height: 2rem;
    padding: 0.25rem 0.5rem;
    color: inherit;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-radius: calc(var(--ob-radius) * 0.6);
    cursor: pointer;
  }

  .zoom-controls span {
    min-width: 3rem;
    color: var(--ob-color-text-muted);
    text-align: center;
    font-size: 0.72rem;
  }

  .viewport {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: var(--ob-color-surface);
    background-image: radial-gradient(var(--ob-color-border) 1px, transparent 1px);
    background-size: 18px 18px;
  }

  .scaled-canvas {
    position: relative;
    min-width: 100%;
    min-height: 100%;
  }

  .surface {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
  }

  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }

  marker path {
    fill: var(--ob-color-text-muted);
  }

  .edge-line {
    fill: none;
    stroke: var(--ob-color-text-muted);
    stroke-width: 2;
  }

  .edge-target {
    fill: none;
    pointer-events: stroke;
    stroke: transparent;
    stroke-width: 16;
    cursor: pointer;
  }

  .edge.selected .edge-line {
    stroke: var(--ob-color-accent);
    stroke-width: 3;
  }

  .node {
    position: absolute;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 0.18rem;
    align-content: center;
    padding: 0.65rem 0.75rem;
    overflow: hidden;
    color: var(--ob-color-text);
    text-align: left;
    background: var(--ob-color-background);
    border: 1px solid var(--ob-color-border);
    border-left: 4px solid var(--ob-color-text-muted);
    border-radius: var(--ob-radius);
    box-shadow: 0 0.25rem 0.8rem rgb(0 0 0 / 8%);
    cursor: pointer;
  }

  .node.selected {
    border-color: var(--ob-color-accent);
    border-left-color: var(--ob-color-accent);
    box-shadow: var(--ob-focus-ring);
  }

  .node-input,
  .node-output {
    border-left-color: var(--ob-color-success);
  }

  .node-exit {
    border-left-color: var(--ob-color-danger);
  }

  .node-type {
    color: var(--ob-color-text-muted);
    font-size: 0.62rem;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .node strong,
  .node-subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-subtitle {
    color: var(--ob-color-text-muted);
    font-family: var(--ob-font-mono);
    font-size: 0.66rem;
  }

  footer {
    max-height: 9rem;
    overflow: auto;
    background: var(--ob-color-background);
    border-top: 1px solid var(--ob-color-border);
  }

  .diagnostics,
  .diagnostics-clear {
    padding: 0.5rem var(--ob-space);
    color: var(--ob-color-text-muted);
    font-size: 0.72rem;
  }

  .diagnostics summary {
    cursor: pointer;
  }

  .diagnostics ul {
    display: grid;
    gap: 0.35rem;
    padding-left: 1.2rem;
  }

  .diagnostics li[data-severity="error"] {
    color: var(--ob-color-danger);
  }

  .empty {
    align-self: start;
    padding: var(--ob-space);
    color: var(--ob-color-text-muted);
  }
`;
