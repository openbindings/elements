import type { OperationGraph } from "@openbindings/operation-graph-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_GRAPH_VIEWER_TAG,
  OperationGraphViewerElement,
} from "./index.js";

if (!customElements.get(OPERATION_GRAPH_VIEWER_TAG)) {
  customElements.define(
    OPERATION_GRAPH_VIEWER_TAG,
    OperationGraphViewerElement,
  );
}

const graph: OperationGraph = {
  "openbindings.operation-graph": "0.2.0",
  nodes: {
    in: { type: "input" },
    get: { type: "operation", operation: "pets.get" },
    out: { type: "output" },
  },
  edges: [
    { from: "in", to: "get" },
    { from: "get", to: "out" },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("OperationGraphViewerElement", () => {
  it("renders nodes and edges and emits selection intent", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_VIEWER_TAG,
    ) as OperationGraphViewerElement;
    element.graph = graph;
    const selected = vi.fn();
    element.addEventListener("ob-graph-node-select", selected);
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelectorAll("[data-node-key]")).toHaveLength(
      3,
    );
    expect(
      element.shadowRoot?.querySelectorAll("[data-edge-index]"),
    ).toHaveLength(2);
    element.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-node-key="get"]')
      ?.click();
    expect(selected.mock.calls[0]?.[0].detail).toEqual({ nodeKey: "get" });
  });

  it("surfaces malformed-edge diagnostics instead of silently omitting them", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_VIEWER_TAG,
    ) as OperationGraphViewerElement;
    element.graph = {
      ...graph,
      edges: [...graph.edges, { from: "missing", to: "out" }],
    };
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelector(".diagnostics")?.textContent).toContain(
      'Edge starts at missing node "missing".',
    );
    expect(element.graph?.edges).toHaveLength(3);
  });

  it("clamps zoom without changing the graph value", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_VIEWER_TAG,
    ) as OperationGraphViewerElement;
    element.graph = graph;
    element.zoom = 20;
    document.body.append(element);
    await settled();

    expect(element.zoom).toBe(2);
    expect(element.graph).toBe(graph);
    expect(element.shadowRoot?.querySelector(".zoom-controls")?.textContent).toContain(
      "200%",
    );
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
