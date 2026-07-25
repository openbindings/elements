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
- `bindingKey: string | null` — optional explicit implementation route. When
  set, the invocation names this binding instead of asking the provider to
  select among bindings for the operation.
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
- `ob-input-change` — `{ operationKey, text, mode }`
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
`input`, `input-mode`, `format-input`, `reset-input`, `run`, `cancel`,
`output`, `clear-output`, `empty`, and `error` parts.

The element owns frame grammar, cancellation, stale-result suppression, and
accessible invocation state. Applications own candidate implementations,
credentials, trust, and preference.

An operation with input starts from a conservative value derived from declared
schema evidence such as `example`, `default`, `const`, `enum`, and required
properties. The element does not invent domain values or claim that the
starter is valid when an unresolved or unsupported schema prevents that.
It refuses to generate a starter for constraints it cannot represent
conservatively (for example a patterned required string or a required
property with no derivable value). `Reset starter` restores this evidence-based
draft; `Format JSON` never changes the decoded value. Runtime operation
validation remains authoritative.
Single mode sends one complete JSON value. Sequence mode is explicit so a JSON
array value remains distinguishable from several input values: one array input
is entered in single mode; several values are entered as the members of an
outer array in sequence mode.

Invocation failures have a concise user-facing summary and retain the exact
code and message under “Technical details.”
