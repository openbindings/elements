# `@openbindings/ui-core`

Small framework-neutral utilities shared by OpenBindings elements.

`OperationEnvironment` is application-owned reactive state containing concrete
OpenBindings operation implementations. Elements receive its read-only
`OperationSource` face. This keeps delegate registration, preference, trust,
and credential policy outside elements while still allowing availability to
change reactively.

This package has no DOM side effects and registers no custom elements.

## Theme tokens

Every element adopts `baseStyles` and consumes the shared public `--ob-*`
tokens. Internals read private `--_ob-*` names that default through the public
tokens (`--_ob-x: var(--ob-x, <default>)`), which is what lets a public token
set on any ancestor inherit into the shadow tree while an element-level
override still wins. The private `--_ob-*` names are not API; set only the
public tokens listed here.

| Token | Default | Controls |
| --- | --- | --- |
| `--ob-color-background` | `#ffffff` | Base background behind element content |
| `--ob-color-surface` | `#f7f7f5` | Raised surfaces such as panels and toolbars |
| `--ob-color-surface-strong` | `#efefec` | Stronger surface for hover, active, and emphasized regions |
| `--ob-color-text` | `#171714` | Primary text color |
| `--ob-color-text-muted` | `#686862` | Secondary and descriptive text |
| `--ob-color-border` | `#d9d9d3` | Borders and dividers |
| `--ob-color-accent` | `#305cff` | Accent for interactive and selected states |
| `--ob-color-accent-contrast` | `#ffffff` | Text and icons rendered on the accent color |
| `--ob-color-danger` | `#b42318` | Error and destructive states |
| `--ob-color-success` | `#18794e` | Success states |
| `--ob-font-family` | `Inter, ui-sans-serif, system-ui, sans-serif` | UI text font stack |
| `--ob-font-mono` | `"SFMono-Regular", Consolas, "Liberation Mono", monospace` | Monospace font for code and values |
| `--ob-font-size` | `0.875rem` | Base font size |
| `--ob-radius` | `0.5rem` | Corner radius |
| `--ob-space` | `0.75rem` | Base spacing unit |
| `--ob-focus-ring` | `0 0 0 3px color-mix(in srgb, var(--_ob-color-accent) 28%, transparent)` | Focus indicator box-shadow on form controls |

`@openbindings/json-editor` additionally exposes `--ob-editor-*` tokens for
its own typography and token colours; see that package's README.

## Authoring an element

`OpenBindingsElement` is an import-safe `HTMLElement` base with a small
contract: `shell()` parses markup and adopts stylesheets exactly once and
returns a cached `Refs` lookup, `bind()` runs once immediately after the shell
is created (listeners bound there stay bound because shell nodes are stable),
and `render()` runs on a microtask after each `requestRender()` and mutates
persistent nodes instead of replacing the shadow root — preserving focus,
selection, and scroll position:

```ts
import {
  OpenBindingsElement,
  baseStyles,
  defineElement,
  type Refs,
} from "@openbindings/ui-core";

const markup = `
  <p class="count" part="count"></p>
  <button class="increment" part="increment">Increment</button>
`;

const styles = `:host { display: block; padding: var(--_ob-space); }`;

class CounterElement extends OpenBindingsElement {
  #count = 0;

  protected override bind(refs: Refs): void {
    refs.require(".increment").addEventListener("click", () => {
      this.#count += 1;
      this.emit("count-change", { count: this.#count });
      this.requestRender();
    });
  }

  protected override render(): void {
    const refs = this.shell(markup, baseStyles, styles);
    if (!refs) return;
    refs.require(".count").textContent = String(this.#count);
  }
}

defineElement("my-counter", CounterElement);
```

`emit(name, detail)` dispatches a bubbling, composed `CustomEvent`.
`defineElement(tag, constructor)` registers a tag exactly once and is a no-op
where `customElements` does not exist.

## Operation implementations

Elements that need behavior receive a read-only `OperationSource`; the
application owns the mutable collection and all policy that produced it. Each
entry is an SDK `OperationImplementation`:

```ts
interface OperationImplementation {
  readonly interface: OBInterface;    // concrete provider OBI
  readonly invoker: OperationInvoker; // SDK invoker able to invoke it
  readonly label?: string;            // display name for pickers and status
  readonly preference?: number;       // higher wins; an equal tie is ambiguous
}

interface OperationSource {
  snapshot(): readonly OperationImplementation[];
  subscribe(listener: () => void): () => void; // returns unsubscribe
}
```

`OperationEnvironment` implements `OperationSource` with a frozen snapshot and
a `replace(implementations)` method that notifies subscribers; elements
re-resolve without owning or mutating application state.
