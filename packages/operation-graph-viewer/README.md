# `@openbindings/operation-graph-viewer`

A read-only, framework-neutral operation graph viewer.

The viewer accepts one graph value, lays it out locally, preserves unknown
node types, and exposes structural diagnostics without claiming to replace the
binding specification's validator. It performs no invocation and no edits.

```ts
import "@openbindings/operation-graph-viewer/define";

const viewer = document.querySelector("ob-operation-graph-viewer");
viewer.graph = graph;
viewer.addEventListener("ob-graph-node-select", event => {
  showNode(event.detail.nodeKey);
});
```

Properties: `graph`, `selectedNodeKey`, `selectedEdgeIndex`, and `zoom`.

Events: `ob-graph-node-select` with `{ nodeKey }` and
`ob-graph-edge-select` with `{ edgeIndex, edge }`.

The shared graph model is exported separately from
`@openbindings/operation-graph-model`; no operation-graph invoker is bundled.
