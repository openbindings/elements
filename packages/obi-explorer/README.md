# `@openbindings/obi-explorer`

Read-only navigation for one OpenBindings interface.

```html
<ob-obi-explorer></ob-obi-explorer>
<script type="module">
  import "@openbindings/obi-explorer/define";

  const explorer = document.querySelector("ob-obi-explorer");
  explorer.obi = obi;
  explorer.addEventListener("ob-operation-select", event => {
    console.log(event.detail.operationKey);
  });
</script>
```

## Properties

- `obi: OBInterface | null`
- `selectedOperation: string | null`
- `filter: string`

## Events

- `ob-operation-select` — `CustomEvent<{ operationKey, operation }>`

The package augments `HTMLElementTagNameMap` and types this event on
`OBIExplorerElement`, so TypeScript infers both `querySelector` and listener
payloads after the package is imported.

## Customization

The element inherits the shared `--ob-*` theme variables and exposes
`container`, `header`, `filter`, `operation-list`, and `operation` parts.

This element has no operation dependencies and performs no network or storage
work.
