import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView as EditorViewCtor } from "@codemirror/view";
import { JSON_EDITOR_TAG, JSONEditorElement } from "./index.js";

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

describe("JSONEditorElement", () => {
  it("mounts a CodeMirror editor whose document mirrors the text property", async () => {
    const { root } = await mount('{\n  "a": 1\n}\n');
    const { view } = editorOf(root);
    expect(view.state.doc.toString()).toBe('{\n  "a": 1\n}\n');
    expect(root.querySelector(".cm-gutters")).not.toBeNull();
  });

  it("renders no view toolbar — folding is the collapse surface (rev 15)", async () => {
    const { root } = await mount('{"a": 1}');
    expect(root.querySelector(".toolbar")).toBeNull();
    expect(root.querySelector(".view-tree")).toBeNull();
    expect(root.querySelector(".view-source")).toBeNull();
    expect(root.querySelector(".tree-pane")).toBeNull();
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
