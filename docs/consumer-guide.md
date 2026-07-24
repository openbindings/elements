# Consumer guide

## Choose only the packages you use

The elements are independently published. An interface list and detail view
need no invocation code:

```ts
import "@openbindings/obi-explorer/define";
import "@openbindings/operation-detail/define";
```

An invocation surface adds the workbench, `ui-core`, the OpenBindings SDK, and
only the binding invokers present in the implementation candidates your
application supplies. An OpenAPI-only deployment does not need gRPC, GraphQL,
MCP, or another unused family.

Importing a package's default entry exports its class but does not mutate the
Custom Elements registry. Import the explicit `/define` entry when automatic
tag registration is wanted.

## Supply values through properties

OBIs and operation implementation sources are JavaScript objects, not
serialized HTML attributes:

```ts
const explorer = document.querySelector("ob-obi-explorer");
explorer.obi = interfaceDocument;
explorer.selectedOperation = "orders.create";
```

This property boundary works in plain browser modules and in frameworks that
support Custom Element properties. A framework adapter, if a team wants one,
should remain a thin local convenience rather than a second component API.

## Compose through DOM events

Elements do not know about each other. The application decides what selection
means:

```ts
explorer.addEventListener("ob-operation-select", event => {
  detail.operationKey = event.detail.operationKey;
  workbench.operationKey = event.detail.operationKey;
});
```

Events bubble and cross the shadow boundary. Their package READMEs document
the detail payloads.

## Supply operation implementations

Behavioral elements consume the read-only `OperationSource` interface.
`OperationEnvironment` is a small application-owned implementation:

```ts
import { OperationEnvironment } from "@openbindings/ui-core";

const environment = new OperationEnvironment([
  {
    interface: providerOBI,
    invoker: browserSafeOperationInvoker,
    label: "Current API",
    preference: 10,
  },
]);

workbench.operationSource = environment;
```

The provider OBI must be compatible with the element's published requirement;
for the workbench that is
`openbindings.operation-invoker.invokeOperation`. Resolution is conservative:
zero matches is unavailable, one highest-preference match is available, and an
equal-preference tie is ambiguous. The element never breaks a tie using
registration order or hidden policy.

Call `environment.replace(nextImplementations)` when application state
changes. Elements re-resolve without owning or mutating that state.

## Context and credentials

The application passes target invocation context by value:

```ts
workbench.context = { bearerToken: targetToken };
```

The element retains it only as the assigned property value and forwards it in
the Operation Invoker `open` frame. It does not persist, prompt for, discover,
or choose credentials. A `CONTEXT_REQUIRED` terminal emits
`ob-context-required`; the application decides whether and how to satisfy it.

## Customize without internal selectors

All elements inherit the shared `--ob-*` variables. Each package README lists
its stable `part` names:

```css
ob-operation-workbench {
  --ob-color-accent: rebeccapurple;
  --ob-radius: 0.35rem;
}

ob-operation-workbench::part(run) {
  font-weight: 700;
}
```

Internal class names and shadow-DOM structure are not API.

## Server rendering and edge deployment

Class entry points are import-safe when `HTMLElement` and
`customElements` do not exist. The packages do not import Node built-ins or
ship a Node runtime. Actual element construction and rendering still happen in
a browser DOM.

The browser-import check bundles every public entry against a browser target
and rejects framework, Node, and binding-family imports in public element
packages.
