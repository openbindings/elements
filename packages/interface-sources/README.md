# `@openbindings/interface-sources`

A framework-neutral inspector for an OpenBindings interface's sources and
bindings.

The element renders ordinary OBI values and emits user intent. It never fetches
a source location, treats `location` as competing with embedded `content`,
rewrites a binding, or persists a document. The application decides which
operations can fulfill refresh and mutation intents.

```ts
import "@openbindings/interface-sources/define";

const sources = document.querySelector("ob-interface-sources");
sources.obi = interfaceDocument;
sources.addEventListener("ob-source-refresh", event => {
  sourceManager.refresh(event.detail.sourceKey);
});
sources.addEventListener("ob-binding-select", event => {
  showBinding(event.detail.bindingKey);
});
```

## Properties

- `obi: OBInterface | null`
- `selectedSourceKey: string | null`
- `selectedBindingKey: string | null`
- `filter: string` — case-insensitive substring narrowing over sources AND
  bindings (source key, bindingSpec, location; binding key, operation, ref).
  A source stays visible when any of its bindings match, and vice versa. The
  count line reports `N / total` honesty while a filter is active.
- `flowContent: boolean` (attribute `flow-content`) — master-pane mode: the
  element does not scroll internally (host height is content height), and
  the header becomes a compact sticky "Sources" heading pinned at
  `--ob-rail-sticky-top` (default `0`), which the host sets to sit below a
  sibling explorer's sticky filter.

## Events

- `ob-source-select` — `{ sourceKey }`
- `ob-source-refresh` — `{ sourceKey }`
- `ob-source-remove` — `{ sourceKey }`
- `ob-binding-select` — `{ bindingKey, sourceKey, operationKey }`
- `ob-binding-remove` — `{ bindingKey, sourceKey, operationKey }`

All events bubble across the shadow boundary. Refresh and removal events are
requests, not mutations: the supplied `obi` remains untouched until the
application supplies a replacement value.

## Styling

Use shared `--ob-*` design tokens and CSS parts `container`, `source-list`,
`source`, `selected-source`, `source-actions`, `binding-list`, `binding`, and
`selected-binding`.
