export interface OperationGraph {
  "openbindings.operation-graph": string;
  description?: string;
  nodes: Record<string, OperationGraphNode>;
  edges: OperationGraphEdge[];
}

export interface OperationGraphNode {
  type: string;
  onError?: string;
  operation?: string;
  timeout?: number;
  maxIterations?: number;
  limit?: number;
  until?: unknown;
  through?: unknown;
  schema?: unknown;
  transform?: string;
  error?: boolean;
}

export interface OperationGraphEdge {
  from: string;
  to: string;
}

export interface OperationGraphDiagnostic {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface OperationGraphPoint {
  x: number;
  y: number;
}

export interface OperationGraphLayout {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  positions: Record<string, OperationGraphPoint>;
}

export type OperationGraphPatch =
  | {
      type: "add-node";
      nodeKey: string;
      node: OperationGraphNode;
    }
  | {
      type: "set-node";
      nodeKey: string;
      node: OperationGraphNode;
    }
  | {
      type: "remove-node";
      nodeKey: string;
      removeIncidentEdges: boolean;
    }
  | {
      type: "add-edge";
      edge: OperationGraphEdge;
      index?: number;
    }
  | {
      type: "remove-edge";
      index: number;
    }
  | {
      type: "set-description";
      description?: string;
    };

const knownNodeTypes = new Set([
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
]);

export function isOperationGraph(value: unknown): value is OperationGraph {
  if (!isRecord(value) || !isRecord(value.nodes) || !Array.isArray(value.edges)) {
    return false;
  }
  if (typeof value["openbindings.operation-graph"] !== "string") return false;
  for (const node of Object.values(value.nodes)) {
    if (!isRecord(node) || typeof node.type !== "string") return false;
  }
  return value.edges.every(
    edge =>
      isRecord(edge) &&
      typeof edge.from === "string" &&
      typeof edge.to === "string",
  );
}

/**
 * Structural UI diagnostics only. Binding-spec conformance remains the job of
 * an openbindings.operation-graph@1 processor.
 */
export function diagnoseOperationGraph(
  value: unknown,
): OperationGraphDiagnostic[] {
  if (!isRecord(value)) {
    return [
      {
        severity: "error",
        path: "",
        message: "Graph must be a JSON object.",
      },
    ];
  }
  const diagnostics: OperationGraphDiagnostic[] = [];
  if (value["openbindings.operation-graph"] !== "0.2.0") {
    diagnostics.push({
      severity: "error",
      path: "/openbindings.operation-graph",
      message: "This UI understands graph edition 0.2.0 exactly.",
    });
  }
  if (!isRecord(value.nodes)) {
    diagnostics.push({
      severity: "error",
      path: "/nodes",
      message: "nodes must be an object keyed by node identifier.",
    });
  }
  if (!Array.isArray(value.edges)) {
    diagnostics.push({
      severity: "error",
      path: "/edges",
      message: "edges must be an array.",
    });
  }
  if (!isRecord(value.nodes) || !Array.isArray(value.edges)) return diagnostics;

  const nodeKeys = new Set(Object.keys(value.nodes));
  let inputs = 0;
  let outputs = 0;
  for (const [key, node] of Object.entries(value.nodes)) {
    if (!isRecord(node) || typeof node.type !== "string") {
      diagnostics.push({
        severity: "error",
        path: `/nodes/${pointerToken(key)}`,
        message: "Node must be an object with a string type.",
      });
      continue;
    }
    if (!knownNodeTypes.has(node.type)) {
      diagnostics.push({
        severity: "warning",
        path: `/nodes/${pointerToken(key)}/type`,
        message: `Unknown node type ${JSON.stringify(node.type)} is preserved.`,
      });
    }
    if (node.type === "input") inputs += 1;
    if (node.type === "output") outputs += 1;
    if (
      typeof node.onError === "string" &&
      !nodeKeys.has(node.onError)
    ) {
      diagnostics.push({
        severity: "error",
        path: `/nodes/${pointerToken(key)}/onError`,
        message: `onError references missing node ${JSON.stringify(node.onError)}.`,
      });
    }
  }
  if (inputs !== 1) {
    diagnostics.push({
      severity: "warning",
      path: "/nodes",
      message: `Graph has ${inputs} input nodes; the format requires exactly one.`,
    });
  }
  if (outputs !== 1) {
    diagnostics.push({
      severity: "warning",
      path: "/nodes",
      message: `Graph has ${outputs} output nodes; the format requires exactly one.`,
    });
  }

  const seenEdges = new Set<string>();
  for (const [index, edge] of value.edges.entries()) {
    if (
      !isRecord(edge) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string"
    ) {
      diagnostics.push({
        severity: "error",
        path: `/edges/${index}`,
        message: "Edge must contain string from and to node keys.",
      });
      continue;
    }
    if (!nodeKeys.has(edge.from)) {
      diagnostics.push({
        severity: "error",
        path: `/edges/${index}/from`,
        message: `Edge starts at missing node ${JSON.stringify(edge.from)}.`,
      });
    }
    if (!nodeKeys.has(edge.to)) {
      diagnostics.push({
        severity: "error",
        path: `/edges/${index}/to`,
        message: `Edge ends at missing node ${JSON.stringify(edge.to)}.`,
      });
    }
    const identity = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(identity)) {
      diagnostics.push({
        severity: "warning",
        path: `/edges/${index}`,
        message: "Duplicate edge is preserved.",
      });
    }
    seenEdges.add(identity);
  }
  return diagnostics;
}

export function layoutOperationGraph(
  graph: OperationGraph,
): OperationGraphLayout {
  const nodeWidth = 176;
  const nodeHeight = 76;
  const columnGap = 84;
  const rowGap = 34;
  const margin = 36;
  const keys = Object.keys(graph.nodes);
  const incoming = new Map(keys.map(key => [key, 0]));
  const outgoing = new Map(keys.map(key => [key, [] as string[]]));
  for (const edge of graph.edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const level = new Map<string, number>();
  const queue = keys.filter(
    key => graph.nodes[key]?.type === "input" || incoming.get(key) === 0,
  );
  for (const key of queue) level.set(key, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]!;
    const current = level.get(from) ?? 0;
    for (const to of outgoing.get(from) ?? []) {
      if (!level.has(to)) {
        level.set(to, current + 1);
        queue.push(to);
      }
    }
  }
  let fallbackLevel = Math.max(0, ...level.values()) + 1;
  for (const key of keys) {
    if (!level.has(key)) {
      level.set(key, fallbackLevel);
      fallbackLevel += 1;
    }
  }

  const columns = new Map<number, string[]>();
  for (const key of keys) {
    const column = level.get(key) ?? 0;
    const entries = columns.get(column) ?? [];
    entries.push(key);
    columns.set(column, entries);
  }
  const maxRows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const maxColumn = Math.max(0, ...columns.keys());
  const positions: Record<string, OperationGraphPoint> = {};
  for (const [column, entries] of columns) {
    const usedHeight =
      entries.length * nodeHeight + Math.max(0, entries.length - 1) * rowGap;
    const totalHeight =
      maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap;
    const offset = (totalHeight - usedHeight) / 2;
    for (const [row, key] of entries.entries()) {
      positions[key] = {
        x: margin + column * (nodeWidth + columnGap),
        y: margin + offset + row * (nodeHeight + rowGap),
      };
    }
  }
  return {
    width: margin * 2 + (maxColumn + 1) * nodeWidth + maxColumn * columnGap,
    height:
      margin * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap,
    nodeWidth,
    nodeHeight,
    positions,
  };
}

export function applyOperationGraphPatches(
  graph: OperationGraph,
  patches: readonly OperationGraphPatch[],
): OperationGraph {
  const next = structuredClone(graph);
  for (const patch of patches) {
    switch (patch.type) {
      case "add-node": {
        requireNodeKey(patch.nodeKey);
        if (Object.hasOwn(next.nodes, patch.nodeKey)) {
          throw new Error(`node ${JSON.stringify(patch.nodeKey)} already exists`);
        }
        next.nodes[patch.nodeKey] = structuredClone(patch.node);
        break;
      }
      case "set-node": {
        requireExistingNode(next, patch.nodeKey);
        next.nodes[patch.nodeKey] = structuredClone(patch.node);
        break;
      }
      case "remove-node": {
        requireExistingNode(next, patch.nodeKey);
        delete next.nodes[patch.nodeKey];
        if (patch.removeIncidentEdges) {
          next.edges = next.edges.filter(
            edge => edge.from !== patch.nodeKey && edge.to !== patch.nodeKey,
          );
        }
        break;
      }
      case "add-edge": {
        requireExistingNode(next, patch.edge.from);
        requireExistingNode(next, patch.edge.to);
        const edge = structuredClone(patch.edge);
        if (patch.index === undefined) next.edges.push(edge);
        else {
          if (
            !Number.isInteger(patch.index) ||
            patch.index < 0 ||
            patch.index > next.edges.length
          ) {
            throw new Error("edge insertion index is out of range");
          }
          next.edges.splice(patch.index, 0, edge);
        }
        break;
      }
      case "remove-edge": {
        if (
          !Number.isInteger(patch.index) ||
          patch.index < 0 ||
          patch.index >= next.edges.length
        ) {
          throw new Error("edge removal index is out of range");
        }
        next.edges.splice(patch.index, 1);
        break;
      }
      case "set-description": {
        if (patch.description === undefined) delete next.description;
        else next.description = patch.description;
        break;
      }
    }
  }
  return next;
}

function requireExistingNode(graph: OperationGraph, key: string): void {
  requireNodeKey(key);
  if (!Object.hasOwn(graph.nodes, key)) {
    throw new Error(`node ${JSON.stringify(key)} does not exist`);
  }
}

function requireNodeKey(key: string): void {
  if (!key.trim()) throw new Error("node key must not be empty");
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
