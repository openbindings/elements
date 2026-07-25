# `@openbindings/operation-graph-model`

Pure data types and layout/edit helpers shared by the operation graph viewer,
editor, and host applications.

The model mirrors the artifact fields needed to display and edit an
`openbindings.operation-graph@1` graph without importing an invoker or a
protocol-family implementation. Its diagnostics are structural UI guidance,
not a substitute for the binding specification's conformance validator.

`applyOperationGraphPatches` is immutable and fail-closed: it rejects missing
targets, duplicate node keys, and invalid patch values. Removing incident
edges must be explicitly requested; node deletion never silently repairs the
graph.
