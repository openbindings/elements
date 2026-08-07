# @openbindings/json-editor

`<ob-json-editor>` — a framework-neutral source editor for JSON and YAML, with
syntax highlighting, a line-number gutter, structural indent handling, and
code folding.

The element is a pure view. It never fetches, persists, authenticates, parses
against a schema, or decides what a document means; it holds text, shows it
legibly, and reports edits. An application owns validation and everything
downstream of it.

## Why a textarea and not a rich editor

The editable surface is a real `<textarea>` with a highlighted layer painted
behind it. That keeps native selection, IME composition, undo history, drag and
drop, spellcheck suppression, and the accessibility semantics of a single
labelled form control — none of which a `contenteditable` re-implementation
gets right without a great deal of code. The highlight layer is `aria-hidden`
and `pointer-events: none`, so assistive technology sees exactly one editable
control and the layer only carries colour.

Highlighting is debounced and the textarea is never re-rendered while the
author is typing, so a keystroke costs the same in a 10-line document and a
10,000-line one. Only the catch-up repaint scales, and it stops entirely above
`HIGHLIGHT_LIMIT` (400 KB), where the layer falls back to plain text rather
than spending frames colouring a document nobody is reading token by token.

## Usage

```js
import "@openbindings/json-editor/define";

const editor = document.createElement("ob-json-editor");
editor.text = '{\n  "a": 1\n}\n';
editor.language = "json";           // "json" | "yaml"
editor.addEventListener("ob-json-input", event => {
  console.log(event.detail.text, event.detail.structured);
});
document.body.append(editor);
```

Importing the class does not register the tag. Import `./define` to register
`ob-json-editor`, or call `defineElement` yourself.

## Properties

| Property | Type | Notes |
| --- | --- | --- |
| `text` | `string` | The document source. Assigning does not emit `ob-json-input`. |
| `language` | `"json" \| "yaml"` | Selects the tokenizer. |
| `readOnly` | `boolean` | Disables editing. |
| `placeholder` | `string` | Shown when the document is empty. |
| `label` | `string` | Accessible name for the editable control. |
| `errorLine` | `number \| null` | 1-based line to mark in the gutter. |

## Methods

- `format()` — reformats JSON with two-space indentation. Returns `false`
  when the document does not parse, rather than throwing.
- `focusEditor()` — moves focus to the editable surface.

## Events

| Event | Detail | When |
| --- | --- | --- |
| `ob-json-input` | `{ text, structured }` | The author edited. `structured` is `true` for a `format()`, `false` for a keystroke. |

The event bubbles and is composed.

## Editing affordances

The editor handles the things a bare textarea does not: Tab and Shift+Tab
indent and outdent the selected block, Enter preserves the current indent and
opens a level after `{` or `[`, and typing a bracket or quote at a boundary
completes the pair or wraps the selection. None of it fires mid-token, so it
does not fight ordinary typing. The fold gutter collapses containers in
place, so inspecting a large document needs no separate tree mode.

## Styling

Theme tokens come from `@openbindings/ui-core`. Token colours are additionally
exposed and are the intended customisation point:

```css
ob-json-editor {
  --ob-editor-font-size: 0.8rem;
  --ob-editor-token-key: rebeccapurple;
  --ob-editor-token-string: seagreen;
}
```

Parts: `frame`, `source`, `input`.

The token API is a renderer adapter, not a second language taxonomy. Its
default mapping is key/name, string, number, keyword, punctuation, comment,
and invalid. A host may collapse distinctions, but invalid material retains a
wavy underline so error meaning never depends on color alone. Official
OpenBindings applications map these tokens from machine-material revision 1
in [`openbindings/design`](https://github.com/openbindings/design/blob/main/experience/machine-material.md).

Styles are attached with `adoptedStyleSheets`, so the element emits no inline
`<style>` and works under a `style-src` policy that forbids inline styles.
