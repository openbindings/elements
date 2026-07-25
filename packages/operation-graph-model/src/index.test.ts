import { describe, expect, it } from "vitest";
import {
  applyOperationGraphPatches,
  diagnoseOperationGraph,
  layoutOperationGraph,
  type OperationGraph,
} from "./index.js";

const graph: OperationGraph = {
  "openbindings.operation-graph": "0.2.0",
  nodes: {
    in: { type: "input" },
    load: { type: "operation", operation: "pets.list" },
    out: { type: "output" },
  },
  edges: [
    { from: "in", to: "load" },
    { from: "load", to: "out" },
  ],
};

describe("operation graph UI model", () => {
  it("lays out the identity path from left to right", () => {
    const layout = layoutOperationGraph(graph);
    expect(layout.positions.in?.x).toBeLessThan(layout.positions.load?.x ?? 0);
    expect(layout.positions.load?.x).toBeLessThan(layout.positions.out?.x ?? 0);
  });

  it("reports missing endpoints without silently dropping their edges", () => {
    const broken: OperationGraph = {
      ...graph,
      edges: [...graph.edges, { from: "missing", to: "out" }],
    };
    expect(diagnoseOperationGraph(broken)).toContainEqual({
      severity: "error",
      path: "/edges/2/from",
      message: 'Edge starts at missing node "missing".',
    });
    expect(broken.edges).toHaveLength(3);
  });

  it("requires explicit incident-edge removal when deleting a node", () => {
    const dangling = applyOperationGraphPatches(graph, [
      {
        type: "remove-node",
        nodeKey: "load",
        removeIncidentEdges: false,
      },
    ]);
    expect(dangling.edges).toHaveLength(2);
    expect(diagnoseOperationGraph(dangling).filter(item => item.severity === "error")).toHaveLength(2);

    const removed = applyOperationGraphPatches(graph, [
      {
        type: "remove-node",
        nodeKey: "load",
        removeIncidentEdges: true,
      },
    ]);
    expect(removed.edges).toEqual([]);
  });
});
