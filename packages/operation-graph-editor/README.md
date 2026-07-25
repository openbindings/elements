# `@openbindings/operation-graph-editor`

A framework-neutral operation graph editor that emits immutable edit intent.

The editor composes the standalone graph viewer, accepts one graph value, and
emits typed patches. It never mutates the supplied graph, persists a graph,
silently repairs dangling edges, or invokes operations.

```ts
import "@openbindings/operation-graph-editor/define";
import { applyOperationGraphPatches } from "@openbindings/operation-graph-model";

editor.graph = graph;
editor.addEventListener("ob-graph-patch", event => {
  if (event.detail.requiresConfirmation && !approve(event.detail.reason)) {
    return;
  }
  graph = applyOperationGraphPatches(graph, event.detail.patches);
  editor.graph = graph;
});
```

Properties: `graph`, `selectedNodeKey`, and `operationKeys`.

`ob-graph-patch` carries `{ patches, reason, requiresConfirmation }`. The
focused editor keeps an existing node's type fixed; changing type is expressed
as an explicit remove/add decision so type-specific fields are never silently
discarded. Removing a node with incident edges requires confirmation; the
emitted removal names whether those edges are to be removed rather than
silently deciding.

Applications own history, undo, autosave, routing, invocation, and
confirmation policy.
