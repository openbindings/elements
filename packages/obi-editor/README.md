# `@openbindings/obi-editor`

A framework-neutral source editor for OpenBindings interface documents.

The editor accepts an ordinary OBI value or source text, supports JSON and
YAML authoring, and reports both parse and OpenBindings validation results. It
does not open URLs, read or write files, persist drafts, synthesize interfaces,
or decide whether edits should replace an application's active interface.

```ts
import "@openbindings/obi-editor/define";
import type { OBIEditorElement } from "@openbindings/obi-editor";

const editor = document.querySelector("ob-obi-editor") as OBIEditorElement;
editor.value = interfaceDocument;
editor.format = "yaml";

editor.addEventListener("ob-interface-edit", event => {
  if (event.detail.valid) {
    preview(event.detail.value);
  }
  setSaveEnabled(event.detail.valid && event.detail.dirty);
});
```

## Properties

- `value: OBInterface | null` — sets a validated application value as the
  editor's new baseline and formats it in the selected format.
- `text: string` — sets source text as the new baseline without emitting an
  edit intent.
- `format: "json" | "yaml"` — sets or converts the displayed syntax.
- `readOnly: boolean`

## Event

`ob-interface-edit` is bubbling and composed. Its detail contains `text`,
`format`, `valid`, `dirty`, and either the validated `value` or an `error`
message. It describes a user edit; the application owns accepting, saving,
previewing, or rejecting that edit.

## Styling

Use the shared `--ob-*` design tokens and the CSS parts `container`, `toolbar`,
`format`, `editor`, `status`, and `reset`.
