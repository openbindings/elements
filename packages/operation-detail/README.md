# `@openbindings/operation-detail`

Read-only detail view for one operation in an OBI.

## Properties

- `obi: OBInterface | null`
- `operationKey: string | null`

## Events

- `ob-binding-select` — `CustomEvent<{ bindingKey, binding }>`

The package augments `HTMLElementTagNameMap` and types the listener payload on
`OperationDetailElement`.

## Customization

The element inherits shared `--ob-*` tokens and exposes `container`, `header`,
`metadata`, `binding-list`, `binding`, `input-schema`, and `output-schema`
parts. Operation examples are exposed through the `examples` part.

This element has no operation dependencies.

Schemas are shown exactly as declared, including `$ref` objects. The element
does not fetch external schema resources or present a partial dereference as a
complete contract.
