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
