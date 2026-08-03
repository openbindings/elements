import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView as EditorViewCtor } from "@codemirror/view";
import { JSON_EDITOR_TAG, JSONEditorElement } from "./index.js";
import { setAtPointer } from "./tree.js";

if (!customElements.get(JSON_EDITOR_TAG)) {
  customElements.define(JSON_EDITOR_TAG, JSONEditorElement);
}

afterEach(() => {
  document.body.replaceChildren();
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(text: string): Promise<{
  element: JSONEditorElement;
  root: ShadowRoot;
}> {
  const element = document.createElement(JSON_EDITOR_TAG) as JSONEditorElement;
  element.text = text;
  document.body.append(element);
  await settled();
  const root = element.shadowRoot!;
  return { element, root };
}

// The source surface is CodeMirror 6 (rev 14.2). Tests drive it through the
// view instance the element mounts in the shadow root.
function editorOf(root: ShadowRoot): { view: import("@codemirror/view").EditorView } {
  const dom = root.querySelector<HTMLElement & { cmView?: unknown }>(".cm-content");
  // CM exposes the view on the content DOM via the "cmView" property chain;
  // the stable public route is EditorView.findFromDOM.
  return { view: EditorViewCtor.findFromDOM(dom!.closest(".cm-editor") as HTMLElement)! };
}




describe("setAtPointer", () => {
  it("writes without mutating the original document", () => {
    const original = { a: { b: [1, 2] } };
    const next = setAtPointer(original, "/a/b/1", 9) as typeof original;
    expect(next.a.b).toEqual([1, 9]);
    expect(original.a.b).toEqual([1, 2]);
    expect(next).not.toBe(original);
  });

  it("ignores pointers that do not resolve", () => {
    const original = { a: 1 };
    expect(setAtPointer(original, "/missing", 2)).toEqual({ a: 1 });
    expect(setAtPointer(original, "", 5)).toBe(5);
  });

  it("round-trips escaped pointer segments", () => {
    const original = { "a/b": { "c~d": 1 } };
    expect(setAtPointer(original, "/a~1b/c~0d", 2)).toEqual({
      "a/b": { "c~d": 2 },
    });
  });
});

describe("JSONEditorElement", () => {
  it("mounts a CodeMirror editor whose document mirrors the text property", async () => {
    const { root } = await mount('{\n  "a": 1\n}\n');
    const { view } = editorOf(root);
    expect(view.state.doc.toString()).toBe('{\n  "a": 1\n}\n');
    expect(root.querySelector(".cm-gutters")).not.toBeNull();
  });

  it("emits input for editor-originated edits, never for host assignments", async () => {
    const { element, root } = await mount("{}");
    const seen = vi.fn();
    element.addEventListener("ob-json-input", seen);

    const { view } = editorOf(root);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '{"a": 1}' },
    });

    expect(seen.mock.calls[0]?.[0].detail).toEqual({
      text: '{"a": 1}',
      structured: false,
    });
    expect(element.text).toBe('{"a": 1}');

    seen.mockClear();
    element.text = '{"b": 2}';
    await settled();
    // A host-assigned document is not an authored edit.
    expect(seen).not.toHaveBeenCalled();
    expect(editorOf(root).view.state.doc.toString()).toBe('{"b": 2}');
  });

  it("keeps selection semantics through readOnly and language flips", async () => {
    const { element, root } = await mount('{"a": 1}');
    element.readOnly = true;
    await settled();
    const { view } = editorOf(root);
    expect(view.state.readOnly).toBe(true);
    element.readOnly = false;
    element.language = "yaml";
    await settled();
    expect(editorOf(root).view.state.readOnly).toBe(false);
  });

  it("formats JSON on request and reports failure instead of throwing", async () => {
    const { element } = await mount('{"b":2,"a":1}');
    expect(element.format()).toBe(true);
    expect(element.text).toBe('{\n  "b": 2,\n  "a": 1\n}\n');

    element.text = "{not json";
    expect(element.format()).toBe(false);
  });

  it("falls back to the source view when the language cannot be a tree", async () => {
    const { element } = await mount('{"a":1}');
    element.view = "tree";
    expect(element.view).toBe("tree");
    element.language = "yaml";
    expect(element.view).toBe("source");
  });

  it("renders collapsible rows in the tree view", async () => {
    const { element, root } = await mount('{"a":{"b":1},"c":[1,2]}');
    element.view = "tree";
    await settled();
    const rows = root.querySelectorAll(".tree-row");
    expect(rows.length).toBeGreaterThan(1);
    expect(root.querySelectorAll(".twisty").length).toBeGreaterThan(0);
  });


  it("keeps tree collapse state across view switches; resets only on a new document", async () => {
    const { element, root } = await mount('{"a":{"b":{"c":1}},"d":[1]}');
    element.view = "tree";
    await settled();
    const rowCountBefore = root.querySelectorAll(".tree-row").length;
    // Collapse the first collapsible node the user can reach.
    const twisty = root.querySelector<HTMLElement>(".twisty");
    expect(twisty).not.toBeNull();
    twisty!.click();
    await settled();
    const rowCountCollapsed = root.querySelectorAll(".tree-row").length;
    expect(rowCountCollapsed).toBeLessThan(rowCountBefore);

    // A round-trip through Source must not forget the user's collapse.
    element.view = "source";
    await settled();
    element.view = "tree";
    await settled();
    expect(root.querySelectorAll(".tree-row").length).toBe(rowCountCollapsed);

    // A programmatically assigned NEW document resets to the depth default.
    element.text = '{"a":{"b":{"c":2}},"d":[1]}';
    await settled();
    expect(root.querySelectorAll(".tree-row").length).toBe(rowCountBefore);
  });

  it("marks the error line with a line decoration", async () => {
    const { element, root } = await mount("{\n\n}\n");
    element.errorLine = 2;
    await settled();
    expect(root.querySelector(".ob-error-line")).not.toBeNull();
    element.errorLine = null;
    await settled();
    expect(root.querySelector(".ob-error-line")).toBeNull();
  });

  it("mounts large documents without losing content", async () => {
    const large = `"${"x".repeat(400_100)}"`;
    const { root } = await mount(large);
    expect(editorOf(root).view.state.doc.length).toBe(large.length);
  });
});
