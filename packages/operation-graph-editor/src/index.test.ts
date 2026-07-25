import {
  applyOperationGraphPatches,
  type OperationGraph,
} from "@openbindings/operation-graph-model";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_GRAPH_EDITOR_TAG,
  OperationGraphEditorElement,
} from "./index.js";

if (!customElements.get(OPERATION_GRAPH_EDITOR_TAG)) {
  customElements.define(
    OPERATION_GRAPH_EDITOR_TAG,
    OperationGraphEditorElement,
  );
}

const graph: OperationGraph = {
  "openbindings.operation-graph": "0.2.0",
  nodes: {
    in: { type: "input" },
    work: { type: "operation", operation: "tasks.run" },
    out: { type: "output" },
  },
  edges: [
    { from: "in", to: "work" },
    { from: "work", to: "out" },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("OperationGraphEditorElement", () => {
  it("emits patches and leaves the supplied graph immutable", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_EDITOR_TAG,
    ) as OperationGraphEditorElement;
    element.graph = graph;
    element.selectedNodeKey = "work";
    const patched = vi.fn();
    element.addEventListener("ob-graph-patch", patched);
    document.body.append(element);
    await settled();

    const operation =
      element.shadowRoot?.querySelector<HTMLSelectElement>(
        '[data-node-field="operation"]',
      );
    if (!operation) throw new Error("missing operation field");
    const custom = document.createElement("option");
    custom.value = "tasks.retry";
    operation.append(custom);
    operation.value = "tasks.retry";
    operation.dispatchEvent(new Event("change", { bubbles: true }));

    const detail = patched.mock.calls[0]?.[0].detail;
    expect(detail.requiresConfirmation).toBe(false);
    expect(graph.nodes.work?.operation).toBe("tasks.run");
    expect(applyOperationGraphPatches(graph, detail.patches).nodes.work).toEqual({
      type: "operation",
      operation: "tasks.retry",
    });
  });

  it("marks cascading node removal for host confirmation", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_EDITOR_TAG,
    ) as OperationGraphEditorElement;
    element.graph = graph;
    element.selectedNodeKey = "work";
    const patched = vi.fn();
    element.addEventListener("ob-graph-patch", patched);
    document.body.append(element);
    await settled();

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-remove-node]")
      ?.click();

    const detail = patched.mock.calls[0]?.[0].detail;
    expect(detail.requiresConfirmation).toBe(true);
    expect(detail.patches).toEqual([
      {
        type: "remove-node",
        nodeKey: "work",
        removeIncidentEdges: true,
      },
    ]);
    expect(graph.nodes.work).toBeDefined();
  });

  it("refuses malformed embedded JSON fields without emitting a patch", async () => {
    const element = document.createElement(
      OPERATION_GRAPH_EDITOR_TAG,
    ) as OperationGraphEditorElement;
    element.graph = {
      ...graph,
      nodes: { ...graph.nodes, gate: { type: "filter" } },
    };
    element.selectedNodeKey = "gate";
    const patched = vi.fn();
    element.addEventListener("ob-graph-patch", patched);
    document.body.append(element);
    await settled();

    const schema =
      element.shadowRoot?.querySelector<HTMLTextAreaElement>(
        '[data-node-field="schema"]',
      );
    if (!schema) throw new Error("missing schema field");
    schema.value = "{";
    schema.dispatchEvent(new Event("change", { bubbles: true }));

    expect(patched).not.toHaveBeenCalled();
    expect(element.shadowRoot?.querySelector(".edit-status")?.textContent).toContain(
      "schema must be valid JSON",
    );
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
