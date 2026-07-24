# OpenBindings Elements

Framework-neutral, independently usable web components for inspecting,
authoring, and invoking OpenBindings interfaces.

This workspace is intentionally not an application framework. Elements accept
ordinary OBI values, publish ordinary DOM events, and use OpenBindings
operation requirements only when they need behavior outside themselves. An
application owns its implementation candidates, selection preferences,
credentials, persistence, routing, and trust policy.

The first vertical slice contains:

- `@openbindings/ui-core`
- `@openbindings/obi-explorer`
- `@openbindings/operation-detail`
- `@openbindings/operation-workbench`

The reference workbench is served by `ob start`. It obtains the server's OBI
from `/.well-known/openbindings`, supplies its published Operation Invoker
contract as an implementation, and uses that operation to invoke every target.
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

See [the consumer guide](docs/consumer-guide.md) and
[the design boundaries](docs/design.md). [Current scope](docs/status.md)
records the intentionally separate follow-up elements and the one open
`ob start` carrier design question.
