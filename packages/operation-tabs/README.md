# `@openbindings/operation-tabs`

A framework-neutral tab strip for applications that keep several OpenBindings
operations open at once.

This element deliberately owns no invocation, routing, persistence, or document
state. The application supplies an ordered list of tabs and responds to the
user's activation, close, and reorder intents. That keeps it useful in an
`ob start` workbench, a graph tool, an IDE panel, or any other operation-oriented
workspace.

```ts
import "@openbindings/operation-tabs/define";
import type { OperationTabsElement } from "@openbindings/operation-tabs";

const tabs = document.querySelector("ob-operation-tabs") as OperationTabsElement;
tabs.tabs = [
  { key: "listPets", label: "List pets" },
  { key: "createPet", label: "Create pet", running: true },
];
tabs.activeKey = "listPets";

tabs.addEventListener("ob-tab-activate", event => {
  tabs.activeKey = event.detail.key;
});
tabs.addEventListener("ob-tab-reorder", event => {
  const byKey = new Map(tabs.tabs.map(tab => [tab.key, tab]));
  tabs.tabs = event.detail.keys.flatMap(key => {
    const tab = byKey.get(key);
    return tab ? [tab] : [];
  });
});
```

## Properties

- `tabs: readonly OperationTab[]` — ordered, application-owned tab values.
- `activeKey: string | null` — the active tab. The element does not silently
  choose one.

`OperationTab` has a required `key`, an optional display `label`, and optional
`dirty` and `running` indicators. The key remains the stable identity and is
included in every event.

## Events

- `ob-tab-activate` with `{ key }`
- `ob-tab-close` with `{ key }`
- `ob-tab-rename` with `{ key, label }` — inline rename (double-click the
  label, or F2 on the focused tab; Enter commits, Esc cancels)
- `ob-tab-duplicate` with `{ key }` — "Duplicate tab" in the ••• menu, for
  the active tab
- `ob-tab-reorder` with `{ keys }`
- `ob-tabs-close-unselected`
- `ob-tabs-close-all`

Tabs are `{ key, label?, kind?, dirty?, running? }`; `kind` renders as a
smaller muted subtitle line under the label (a workspace-item token — the
element stays generic and knows nothing about what kinds mean).

Events are bubbling and composed. They communicate user intent; the element
does not mutate the supplied tab list. Consumers can accept, reject, persist,
or guard any intent according to application policy.

## Keyboard and pointer behavior

The strip uses the ARIA tab pattern with roving focus. Arrow keys move focus,
Home and End jump, Enter or Space activates, and Delete requests a close.
Alt+ArrowLeft/ArrowRight requests reordering. Tabs can also be reordered with
mouse drag-and-drop. The actions menu exposes move-left and move-right controls
for touch and other environments without drag or modifier keys.

## Styling

Use the shared `--ob-*` design tokens and these CSS parts:
`container`, `tab-list`, `tab`, `active-tab`, `status`, `close`, and `menu`.
