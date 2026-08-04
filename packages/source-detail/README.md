# `@openbindings/source-detail`

One source's workspace view (rev 16, the tab model): the facts, the verbs,
the bindings derived from it, and an optional inspection report. Sibling of
`@openbindings/operation-detail`; knows nothing about transport — the host
commits every verb through the contract (`pullSource`, `inspectSource`,
`removeSource`, `unbindOperation`).

## Properties

- `obi: OBInterface | null`
- `sourceKey: string | null`
- `inspection: SourceInspection | null` — host-assigned `inspectSource`
  result (bindable targets, exhaustiveness, limitation); cleared
  automatically when `sourceKey` changes
- `pulling: boolean` — host-set while a pull is in flight; disables the Pull
  verb and relabels it

## Events

- `ob-source-pull` `{ sourceKey }`
- `ob-source-inspect` `{ sourceKey }`
- `ob-source-remove` `{ sourceKey }`
- `ob-binding-select` `{ bindingKey, sourceKey, operationKey }` — navigation
  intent: the user clicked a binding row; hosts typically activate its
  operation
- `ob-binding-remove` `{ bindingKey, sourceKey, operationKey }` — unbind
  intent

The package augments `HTMLElementTagNameMap`.

## Content preview

Embedded source content renders read-only inside a `<details>` disclosure
through `ob-json-editor` (JSON, or YAML highlighting for non-JSON source
text), truncated honestly at 256 KiB. The `./define` entry registers the
editor dependency alongside the element.

## Customization

The element inherits shared `--ob-*` tokens and exposes `container`, `empty`,
`header`, `verbs`, `facts`, `content-preview`, `preview-editor`,
`inspection`, `target-list`, `bindings`, `binding-list`, and `binding` parts.
