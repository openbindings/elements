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
const explorer = document.querySelector("ob-obi-explorer");
const detail = document.querySelector("ob-operation-detail");
const workbench = document.querySelector("ob-operation-workbench");

explorer.addEventListener("ob-operation-select", event => {
  detail.operationKey = event.detail.operationKey;
  workbench.operationKey = event.detail.operationKey;
});
```

Events bubble and cross the shadow boundary. Their package READMEs document
the detail payloads.

Editors emit intent; applications commit
-----------------------------------------

The editor and source/graph authoring surfaces never save or mutate the values
assigned to them. The application chooses whether an emitted intent becomes a
local draft, a call to a backend operation, or a persisted change:

```ts
editor.addEventListener("ob-interface-edit", event => {
  applyButton.disabled = !event.detail.valid || !event.detail.dirty;
  pendingDocument = event.detail.valid ? event.detail.value : null;
});

sources.addEventListener("ob-binding-remove", async event => {
  const accepted = await confirmBindingRemoval(event.detail.bindingKey);
  if (accepted) await removeBindingThroughApplicationPolicy(event.detail);
});

graphEditor.addEventListener("ob-graph-patch", event => {
  if (!event.detail.requiresConfirmation || hostConfirmed(event.detail)) {
    graphDraft = applyOperationGraphPatches(graphDraft, event.detail.patches);
  }
});
```

The graph viewer and editor consume the same graph value and shared model, but
remain separate packages. Read-only consumers do not acquire editing,
persistence, execution, or operation-discovery responsibilities.

Operation tabs are also application-owned. The element renders and emits
intent for a supplied array of keyed sessions; the application owns each
session's content and lifecycle. This is what allows the reference workbench
to retain independent invocation state without turning the tab strip into a
workbench-specific component.

## Supply operation implementations

Behavioral elements consume the read-only `OperationSource` interface.
`OperationEnvironment` is a small application-owned implementation. An
`OperationImplementation` pairs a concrete provider OBI with an SDK
`OperationInvoker` plus an optional `label` and `preference`.

### Supply an in-memory implementation

The complete recipe below satisfies the workbench's published requirement
without any network protocol. A `BindingInvoker` drives the Operation Invoker
frame grammar — read `open`, `input`, and `close` frames, then emit `output`
and `complete` — and the provider OBI is the published interface plus the
`sources` and `bindings` that make it invocable:

```ts
import "@openbindings/operation-workbench/define";
import {
  InvocationImpl,
  OperationInvoker,
  type BindingInvocationArgs,
  type BindingInvoker,
  type BindingSpecInfo,
} from "@openbindings/sdk";
import { OperationEnvironment } from "@openbindings/ui-core";
import type {
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "@openbindings/operation-workbench";
import { operationInvokerInterface } from "@openbindings/operation-workbench/requirement";

const LOCAL_BINDING_SPEC = "example.local-operation-invoker@1";

class LocalOperationInvokerBinding implements BindingInvoker {
  bindingSpecs(): BindingSpecInfo[] {
    return [{ bindingSpec: LOCAL_BINDING_SPEC }];
  }

  invokeBinding<I = unknown, O = unknown>(
    _args: BindingInvocationArgs,
  ): InvocationImpl<I, O> {
    const invocation = new InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >();
    queueMicrotask(() => void this.drive(invocation));
    return invocation as unknown as InvocationImpl<I, O>;
  }

  private async drive(
    invocation: InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >,
  ): Promise<void> {
    let targetOperation = "";
    let targetInput: unknown;
    for await (const frame of invocation.inputs()) {
      if (frame.kind === "open") {
        targetOperation = frame.input.operation ?? "";
      } else if (frame.kind === "input") {
        targetInput = frame.value;
      } else if (frame.kind === "close") {
        break;
      }
    }
    invocation.closeInput();
    await invocation.emitOutput({
      kind: "output",
      value: { targetOperation, targetInput },
    });
    await invocation.emitOutput({ kind: "complete" });
    invocation.closeOutput();
  }
}

// The published requirement interface, made invocable by adding the local
// source and a binding for its operation.
const candidate = {
  ...structuredClone(operationInvokerInterface),
  sources: {
    local: { bindingSpec: LOCAL_BINDING_SPEC, content: {} },
  },
  bindings: {
    invoke: {
      operation: "openbindings.operation-invoker.invokeOperation",
      source: "local",
      ref: "invoke",
    },
  },
};

const environment = new OperationEnvironment([
  {
    interface: candidate,
    invoker: new OperationInvoker([new LocalOperationInvokerBinding()]),
    label: "In-memory invoker",
    preference: 10,
  },
]);

const workbench = document.querySelector("ob-operation-workbench")!;
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

### Theming

Elements consume the public `--ob-*` tokens through private fallbacks, so a
token set on any ancestor — `:root`, a layout region, or the element itself —
inherits into every shadow tree below it. The nearest declaration wins under
normal CSS inheritance, which means an element-level override beats a
document-level theme for that element only. The private `--_ob-*` names the
internals read are not API; set only the public tokens. A dark theme should
also declare `color-scheme: dark` alongside its `--ob-*` colors so native
form controls, scrollbars, and `prefers-color-scheme`-derived defaults agree
with the palette:

```css
:root {
  color-scheme: dark;
  --ob-color-background: #16161a;
  --ob-color-text: #e8e8e4;
}
```

The neutral defaults are the contract for independent consumers. Official
OpenBindings products instead vendor reviewed adapters from
[`openbindings/design`](https://github.com/openbindings/design):
`tokens/generated/openbindings-theme.css` at revision `ed8a409` for the
general semantic theme, and the machine-material revision 1 artifacts at
`dc46aff` for code surfaces and syntax roles. Those adapters map official
roles into the same `--ob-*` API; they do not create a second component theme
contract. Raw JSON/YAML serialization remains outside this presentation
layer.

Design foundations revision 1 at `3ef2505` is intentionally looser. Its
generated `--ob-foundation-reference-*` values are optional conventions, not
a second public Elements contract. Hosts can map the reference fonts, corner
anchors, or tempos into the public tokens when useful, interpolate between
them, or use their own expression. Elements itself enforces the behavioral
part by honoring reduced motion in `baseStyles`; focus geometry and component
density remain host-controlled as long as the resulting interface stays
accessible.

## Server rendering and edge deployment

Class entry points are import-safe when `HTMLElement` and
`customElements` do not exist. The packages do not import Node built-ins or
ship a Node runtime. Actual element construction and rendering still happen in
a browser DOM.

The browser-import check bundles every public entry against a browser target
and rejects framework, Node, and binding-family imports in public element
packages.
