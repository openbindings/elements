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

- `obi: OBInterface | null` — the document to explore. Assigning a new
  document clears `selectedOperation` unless the new document declares an
  operation with the same key (and it always resets the description
  expansion and the filter-driven row cache).
- `selectedOperation: string | null` — assigning programmatically scrolls
  the selected row into view (`block: "nearest"`); user clicks do not
  trigger a scroll, since the clicked row is already visible.
- `filter: string` — programmatic assignment filters silently; it never
  emits `ob-filter-change` (see Events).
- `hideIdentity: boolean` (attribute `hide-identity`) — hides only the
  interface name/version header row, for hosts that already present the
  document's identity elsewhere. The description blurb and the operation
  count badge stay.
- `flowContent: boolean` (attribute `flow-content`) — master-pane mode: the
  element does not scroll internally (host height is content height, so an
  outer rail scroller scrolls), and the filter row plus an "Operations"
  section heading become `position: sticky` and pin against that scroller.
  Offsets are tunable via `--ob-rail-sticky-top` (base, default `0`) and
  `--ob-rail-filter-height` (the filter row's pinned height, default
  `3.05rem`); a sibling section pins its own heading at
  `--ob-rail-sticky-top: var(--ob-rail-filter-height)`.

## Rows: tags, aliases, and deprecation

Each operation row renders its key, its description (clamped to two
lines), and its `tags` as chips. `aliases` are **not** rendered as chips,
but both tags and aliases are part of the filter's search haystack — see
Filtering below.

A deprecated operation (`deprecated: true`) renders a danger-tinted
`deprecated` chip ahead of its tag chips and mutes the row's description
(the key stays fully legible so the row remains findable). The chip is
`aria-hidden`; instead, ", deprecated" is appended to the row's accessible
name through visually hidden text. Deprecated operations remain
selectable.

## Filtering

The filter input matches case-insensitively against each operation's key,
description, aliases, and tags. When an operation is visible **only**
because an alias matched, the row shows a muted "alias: <name>" hint so
the match has a visible reason; the hint is omitted when the key,
description, or a tag also matches, and when no filter is active.

The count badge shows the total operation count, switching to
`N / total` (for example `3 / 50`) while a filter is active. A visually
hidden polite live region announces "N of M operations shown" whenever the
visible count changes — keystrokes that do not change the count are not
re-announced.

## Keyboard model

The filter input is an ordinary Tab stop. The operation list that follows
it is **one** Tab stop, managed with a roving tabindex over the native row
buttons:

- `ArrowDown` / `ArrowUp` move focus between visible rows (no wrap)
- `Home` / `End` jump to the first / last visible row
- `Enter` / `Space` activate the focused row (emits `ob-operation-select`)
- `ArrowDown` from the filter input moves focus into the list

Moving focus never selects. When the focused row is filtered out, the
roving stop moves to the first visible row without stealing focus from the
filter input.

## Events

- `ob-operation-select` — `CustomEvent<{ operationKey, operation }>`,
  emitted when the user activates a row by click or keyboard.
- `ob-filter-change` — `CustomEvent<{ filter, visibleCount, totalCount }>`,
  emitted when the user's typing changes the visible result set. It is
  **not** emitted for programmatic `filter` assignment, nor for keystrokes
  that leave the result set unchanged.

Both events are composed and bubble. The package augments
`HTMLElementTagNameMap` and types these events on `OBIExplorerElement`, so
TypeScript infers both `querySelector` and listener payloads after the
package is imported.

## Customization

The element inherits the shared `--ob-*` theme variables and exposes these
parts:

- `container`, `header`, `filter`, `operation-list`, `empty`
- `operation` — every row button
- `operation-selected` — additionally present on the selected row button,
  so the selection can be styled with
  `ob-obi-explorer::part(operation-selected) { … }`

This element has no operation dependencies and performs no network or
storage work.
