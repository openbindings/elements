# `@openbindings/operation-workbench`

Invokes a selected operation through any implementation of the published
OpenBindings Operation Invoker interface.

The element does not receive protocol implementations, URLs, tokens, or an
`ob` client. Its application supplies an `OperationSource`; the element
resolves its canonical `openbindings.operation-invoker.invokeOperation`
requirement against that source.

```html
<ob-operation-workbench></ob-operation-workbench>
<script type="module">
  import "@openbindings/operation-workbench/define";
  import { OperationEnvironment } from "@openbindings/ui-core";

  const environment = new OperationEnvironment([implementation]);
  const workbench = document.querySelector("ob-operation-workbench");
  workbench.obi = targetOBI;
  workbench.operationKey = "orders.create";
  workbench.operationSource = environment;
</script>
```

## Properties

- `obi: OBInterface | null`
- `operationKey: string | null`
- `operationSource: OperationSource | null`
- `context: Record<string, unknown> | null` — context passed by value to the
  selected target invocation
- `inputText: string`
- `inputMode: "single" | "sequence"` — sequence mode interprets the editor as
  one JSON array and writes each member as a distinct input value
- `maxDisplayedOutputs: number` — bounded retained display window; defaults to
  `100`. Every output still emits `ob-output`.

## Events

- `ob-dependency-state` — `{ status, message }`
- `ob-invocation-start` — `{ interface, operationKey }`
- `ob-output` — `{ operationKey, value, index }`
- `ob-input-closed` — `{ operationKey }`
- `ob-context-required` — `{ operationKey, details?, error }`
- `ob-invocation-complete` —
  `{ operationKey, outputs, outputCount, truncated }`; `outputs` is the retained
  display window
- `ob-invocation-error` — `{ error }`

Every event is a bubbling, composed `CustomEvent`. The package augments
`HTMLElementTagNameMap` and types these listener payloads on
`OperationWorkbenchElement`.

## Customization

The element inherits shared `--ob-*` tokens and exposes `container`, `status`,
`input`, `input-mode`, `run`, `cancel`, `output`, `empty`, and `error` parts.

The element owns frame grammar, cancellation, stale-result suppression, and
accessible invocation state. Applications own candidate implementations,
credentials, trust, and preference.

An operation with input starts with an empty editor. The element does not
invent a value from JSON Schema annotations or choose among examples. Single
mode sends one complete JSON value. Sequence mode is explicit so a JSON array
value remains distinguishable from several input values: one array input is
entered in single mode; several values are entered as the members of an outer
array in sequence mode.
