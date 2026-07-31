# `@openbindings/operation-detail`

Read-only detail view for one operation in an OBI.

## Properties

- `obi: OBInterface | null`
- `operationKey: string | null`
- `selectedBindingKey: string | null` — controls the pressed state of a binding
  choice without selecting a route on behalf of the application

## Events

- `ob-binding-select` — `CustomEvent<{ bindingKey, binding }>` emitted when the
  user explicitly chooses one binding

The package augments `HTMLElementTagNameMap` and types the listener payload on
`OperationDetailElement`.

## Customization

The element inherits shared `--ob-*` tokens and exposes `container`, `header`,
`metadata`, `bindings-summary`, `binding-list`, `binding`, `input-schema`, and
`output-schema` parts. Operation examples are exposed through the `examples`
part.

## Bindings disclosure

The bindings section renders as a native `<details>` disclosure. The
always-visible summary line (`bindings-summary` part) reads `Bindings · N`,
and appends ` · via <key>` when `selectedBindingKey` names one of this
operation's bindings. Binding rows render inside the disclosure body,
unchanged.

The disclosure defaults closed when the operation has three or more bindings
and open at two or fewer. The default is applied only when the operation
identity changes; a manual toggle survives re-renders (including
`selectedBindingKey` changes). With zero bindings the section is hidden
entirely — no disclosure chrome is shown.

This element has no operation dependencies.

Schemas are shown exactly as declared, including `$ref` objects. The element
does not fetch external schema resources or present a partial dereference as a
complete contract.
