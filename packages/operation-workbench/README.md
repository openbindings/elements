# `@openbindings/operation-workbench`

Invokes a selected operation through any implementation of the published
OpenBindings Operation Invoker interface.

The element does not receive protocol implementations, URLs, tokens, or an
`ob` client. Its application supplies an `OperationSource`; the element
resolves its canonical `openbindings.operation-invoker.invokeOperation`
requirement against that source.

```html
<ob-operation-workbench></ob-operation-workbench>
<script type="module">
  import "@openbindings/operation-workbench/define";
  import { OperationEnvironment } from "@openbindings/ui-core";

  const environment = new OperationEnvironment([implementation]);
  const workbench = document.querySelector("ob-operation-workbench");
  workbench.obi = targetOBI;
  workbench.operationKey = "orders.create";
  workbench.operationSource = environment;
</script>
```

## Properties

- `obi: OBInterface | null`
- `operationKey: string | null`
- `bindingKey: string | null` — optional explicit implementation route. When
  set, the invocation names this binding instead of asking the provider to
  select among bindings for the operation. When the assigned operation has two
  or more bindings, a compact "via" selector in the header reflects this
  property bidirectionally: assignment updates the selector without emitting,
  an unknown or stale key falls back to the "choose a binding…" placeholder,
  and a user selection sets the property and emits `ob-binding-select`. The
  element applies no selection policy of its own — it never auto-selects a
  binding, by `preference` or otherwise. Selection policy belongs to the host
  application, expressed by setting `bindingKey`.
- `operationSource: OperationSource | null`
- `context: Record<string, unknown> | null` — context passed by value to the
  selected target invocation
- `inputText: string`
- `inputMode: "single" | "sequence"` — sequence mode interprets the editor as
  one JSON array and writes each member as a distinct input value
- `inputView: "json" | "form"` — how the single input value is edited;
  defaults to `"json"`. (The property is named `inputView` because `inputMode`
  already names input cardinality.) Form view renders a schema-driven form
  whose edits patch `inputText` — both views share the JSON text as the single
  source of truth, and `run()` and `ob-input-change` see one input pipeline.
  Form view supports object schemas of primitive, enum, boolean,
  nested-object, and array-of-(primitive|object) fields. It declines with a
  visible reason (disabled toggle title + hint, or an in-pane banner) for
  combinators (`allOf`/`anyOf`/`oneOf`/`not`/`if`), non-object roots,
  unresolvable references, invalid property schemas, and sequence cardinality.
  Improvement over the benchmarked model: local `#/schemas/<name>` references
  are resolved recursively (with a cycle guard) against the interface's
  schemas BEFORE capability analysis, so `$ref`-rooted operation inputs —
  the OpenBindings norm — form-render instead of declining; only genuinely
  unresolvable references decline. When the current text does not parse or
  does not structurally match the schema, the form shows a "no-match" banner
  with Edit-as-JSON and Reset-starter affordances — never a silent fallback.
- `maxDisplayedOutputs: number` — bounded retained display window; defaults to
  `100`. Every output still emits `ob-output`.
- `layout: "stacked" | "split"` — invocation body geometry; defaults to
  `"stacked"`. Split renders the input column, a keyboard-operable resize
  gutter, and the output column side by side. Also accepted as the `layout`
  attribute (unknown attribute values normalize to `"stacked"`). Below a
  36rem container width, split presentation falls back to stacked while the
  property keeps its value; no event fires for the fallback.
- `splitRatio: number` — the input column's share of the split width, clamped
  to `[0.2, 0.8]`; defaults to `0.5`. Assignment reflects into the grid and
  the gutter's `aria-valuenow` but never emits `ob-layout-change`.

## Events

- `ob-dependency-state` — `{ status, message }`
- `ob-layout-change` — `{ splitRatio }`; emitted when the USER resizes the
  split — once at drag end and after each effective keyboard step (ArrowLeft/
  ArrowRight in 2% steps, Home/End to the bounds). Programmatic `splitRatio`
  assignment never echoes. The element owns geometry only; persisting the
  ratio (and where) is the host application's policy.
- `ob-binding-select` — `{ bindingKey, binding }`; the same detail family as
  `@openbindings/operation-detail`. Emitted only when the user chooses a
  binding in the selector; programmatic `bindingKey` assignment never echoes.
- `ob-invocation-start` — `{ interface, operationKey }`
- `ob-output` — `{ operationKey, value, index }`
- `ob-input-change` — `{ operationKey, text, mode }`
- `ob-input-closed` — `{ operationKey }`
- `ob-context-required` — `{ operationKey, data?, error }`
- `ob-invocation-complete` —
  `{ operationKey, outputs, outputCount, truncated, durationMs }`; `outputs` is
  the retained display window and `durationMs` the wall-clock milliseconds from
  run start to the terminal frame
- `ob-invocation-error` — `{ error }`

Every event is a bubbling, composed `CustomEvent`. The package augments
`HTMLElementTagNameMap` and types these listener payloads on
`OperationWorkbenchElement`.

## Methods

- `run(): Promise<void>` — invokes the selected operation with the current
  input; resolves when the invocation settles
- `cancel(): Promise<void>` — cancels the active invocation
- `formatInput(): boolean` — pretty-prints the JSON input without changing the
  decoded value; returns `false` and surfaces the parse error when the text is
  empty or not valid JSON
- `resetInputToSchema(): boolean` — restores the evidence-based starter draft;
  returns `false` when the operation declares no input or no conservative
  starter can be derived
- `clearOutput(): void` — clears the retained output window and result state,
  timings included
- `copyOutput(): Promise<boolean>` — copies the retained output window as
  WYSIWYG-valid JSON: the bare value for a single output, a JSON array of the
  retained values for several; never index, offset, or duration labels

Cmd+Enter (macOS) or Ctrl+Enter runs the operation from anywhere in the input
surface.

## Customization

The element inherits shared `--ob-*` tokens and exposes `container`, `status`,
`binding-bar`, `binding-select`, `input`, `input-mode`, `input-mode-toggle`,
`input-shape`, `form-row`, `form-add`, `form-remove`, `format-input`,
`reset-input`, `run`, `cancel`, `layout-gutter`, `output`, `output-view`,
`output-item`, `output-timing`, `copy-output`, `clear-output`, `empty`, and
`error` parts.

When the resolved input schema is a top-level `oneOf`, an "Input shape"
select (`input-shape` part) appears above the editor in both views. Switching
shapes regenerates the evidence-based starter for the chosen branch and
re-evaluates form capability per branch. `Reset starter` likewise targets the
selected branch.

The split gutter (`layout-gutter`) is a `role="separator"` with
`aria-valuenow` as the input share in percent; it resizes by pointer drag
(with pointer capture) and by keyboard, and is hidden whenever the effective
presentation is stacked — including the automatic narrow fallback.

### Output view

Each output frame renders as its own block inside the capped, scrolling
`output` region, so one array-valued output stays visually distinct from
several streamed values. A single value renders directly; a stream renders one
collapsible `<details open>` block per value whose summary carries the value's
index, its offset from the first frame (for example `+1.2s`), and a one-line
preview — manual open/closed state survives later frames, and per-frame render
cost is the new block only. While a run streams, the count line reads as live
progress (`3 values · streaming…`); on the terminal it settles to the plain
count with a total-duration chip (`1 value` · `213ms`, run start to terminal).
Durations scale devtools-style: whole milliseconds under a second, seconds to
one decimal under a minute, then `1m 23s`. `Copy` writes the retained window
as WYSIWYG-valid JSON (bare value or JSON array, never timing labels), and the
retention window (`maxDisplayedOutputs`) applies to blocks and copy alike.

The binding selector (`binding-bar` wrapping `binding-select`) appears only
when the operation has two or more bindings and is disabled while an
invocation is running. Its option order is display only — descending numeric
`preference`, entries without a preference last, ties lexicographic by binding
key — and is not a selection policy: nothing is preselected, and deprecated
bindings are annotated "· deprecated" rather than hidden.

The `input` part is a nested `ob-json-editor` (registered automatically by
this package's `/define` entry), so it also honors the `--ob-editor-*` tokens
documented by `@openbindings/json-editor` for editor typography and token
colours.

The element owns frame grammar, cancellation, stale-result suppression, and
accessible invocation state. Applications own candidate implementations,
credentials, trust, and preference.

An operation with input starts from a conservative value derived from declared
schema evidence such as `const`, `enum`, `default`, the first member of
`examples`, and required properties. The element does not invent domain values or claim that the
starter is valid when an unresolved or unsupported schema prevents that.
It refuses to generate a starter for constraints it cannot represent
conservatively (for example a patterned required string or a required
property with no derivable value). `Reset starter` restores this evidence-based
draft; `Format JSON` never changes the decoded value. Runtime operation
validation remains authoritative.
Single mode sends one complete JSON value. Sequence mode is explicit so a JSON
array value remains distinguishable from several input values: one array input
is entered in single mode; several values are entered as the members of an
outer array in sequence mode.

Invocation failures have a concise, non-normative user-facing summary and
retain the exact abstract record—`code` plus optional `data`—under “Technical
details.” The label refers to the abstract record only; native protocol
evidence is neither part of that record nor exposed through the component.
