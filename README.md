# OpenBindings Elements

Framework-neutral, independently usable web components for inspecting,
authoring, and invoking OpenBindings interfaces.

This workspace is intentionally not an application framework. Elements accept
ordinary OBI values, publish ordinary DOM events, and use OpenBindings
operation requirements only when they need behavior outside themselves. An
application owns its implementation candidates, selection preferences,
credentials, persistence, routing, and trust policy.

The public package set contains:

- `@openbindings/ui-core`
- `@openbindings/obi-explorer`
- `@openbindings/obi-editor`
- `@openbindings/json-editor`
- `@openbindings/operation-detail`
- `@openbindings/source-detail`
- `@openbindings/operation-workbench`
- `@openbindings/operation-tabs`
- `@openbindings/operation-graph-model`
- `@openbindings/operation-graph-viewer`
- `@openbindings/operation-graph-editor`

The packages remain independent. For example, a documentation site can use
the explorer, the detail views, and the graph viewer without shipping
invocation or graph-authoring code. An application can use the tab strip for
any keyed sessions; it has no OpenBindings dependency.

The reference workbench is served by `ob start`. It obtains the server's OBI
from `/.well-known/openbindings`, supplies its published Operation Invoker
contract as an implementation, and uses that operation to invoke every target.
The composition adds target-scoped operation sessions, resizable panels, a
JSON/YAML interface draft, source and binding inspection, and separate
operation-graph viewing and editing. Edits remain local until an explicit host
action applies them; public elements only emit intent.
The browser carrier for `ob start` itself is deliberately local to the
application: `openbindings.asyncapi@1` refuses reply-bearing WebSocket receive
operations, so the workbench does not pretend the server's frame stream is a
conformant revision-1 AsyncAPI binding. The public elements know nothing about
that carrier. No binding-family implementation ships in the browser bundle;
resolution, synthesis, and target invocation all run through the server's
canonical Operation Invoker operation.

## Design constraints

- Custom Elements, JavaScript properties, DOM events, CSS custom properties,
  and `::part` are the public UI contract.
- No framework or Node runtime is shipped in element packages.
- Importing an element class does not register it. Import the explicit
  `/define` entry point to register its tag.
- Pure views have no operation dependency.
- Heavy elements remain separate packages.
- Elements never fetch, persist, authenticate, or choose a protocol unless
  that behavior is explicitly supplied through an operation implementation.

See each package README for its complete contract.

## Composition model

Pure views receive values. Elements that need behavior declare an operation
requirement and receive a read-only `OperationSource`. The application—not a
global registry and not the element—owns the concrete implementations and the
policy that assembled them:

```text
OBI value ────────────────> explorer / detail

OperationSource snapshot ─> requirement resolution ─> workbench
       ^                                                  |
       | application owns implementations and policy      |
       +--------------------------------------------------+
```

This means a component can be reused with an in-memory implementation, a
browser-safe SDK invoker containing only the binding families the application
needs, an `ob start` delegate, or another compatible provider. The element's
contract does not change.

See [the consumer guide](docs/consumer-guide.md), [the design
boundaries](docs/design.md), and [current scope](docs/status.md).
