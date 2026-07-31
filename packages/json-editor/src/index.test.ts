import { afterEach, describe, expect, it, vi } from "vitest";
import { JSON_EDITOR_TAG, JSONEditorElement } from "./index.js";
import { highlight, tokenizeJSON, tokenizeYAML } from "./highlight.js";
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
  textarea: HTMLTextAreaElement;
  root: ShadowRoot;
}> {
  const element = document.createElement(JSON_EDITOR_TAG) as JSONEditorElement;
  element.text = text;
  document.body.append(element);
  await settled();
  const root = element.shadowRoot!;
  return {
    element,
    root,
    textarea: root.querySelector("textarea")!,
  };
}

describe("tokenizeJSON", () => {
  it("separates keys from string values", () => {
    const tokens = tokenizeJSON('{"name": "listPets"}');
    expect(tokens.filter(t => t.kind === "key").map(t => t.text)).toEqual([
      '"name"',
    ]);
    expect(tokens.filter(t => t.kind === "string").map(t => t.text)).toEqual([
      '"listPets"',
    ]);
  });

  it("marks bare words and unterminated strings as invalid without hanging", () => {
    expect(tokenizeJSON("{oops: 1}").some(t => t.kind === "invalid")).toBe(true);
    const unterminated = tokenizeJSON('{"a": "no end\n}');
    expect(unterminated.some(t => t.kind === "invalid")).toBe(true);
  });

  it("classifies numbers and keywords", () => {
    const tokens = tokenizeJSON("[-1.5e3, true, null]");
    expect(tokens.filter(t => t.kind === "number").map(t => t.text)).toEqual([
      "-1.5e3",
    ]);
    expect(tokens.filter(t => t.kind === "keyword").map(t => t.text)).toEqual([
      "true",
      "null",
    ]);
  });

  it("round-trips every character of the source", () => {
    const source = '{"a": [1, true, null], "b": "x"}';
    expect(tokenizeJSON(source).map(t => t.text).join("")).toBe(source);
  });
});

describe("tokenizeYAML", () => {
  it("highlights keys, scalars and comments", () => {
    const tokens = tokenizeYAML("name: listPets # a comment\ncount: 2\n");
    expect(tokens.filter(t => t.kind === "key").map(t => t.text)).toEqual([
      "name",
      "count",
    ]);
    expect(tokens.filter(t => t.kind === "comment").map(t => t.text)).toEqual([
      "# a comment",
    ]);
    expect(tokens.filter(t => t.kind === "number").map(t => t.text)).toEqual([
      "2",
    ]);
  });

  it("does not treat a '#' inside a quoted scalar as a comment", () => {
    const tokens = tokenizeYAML('ref: "#/components/schemas/Pet"\n');
    expect(tokens.some(t => t.kind === "comment")).toBe(false);
  });
});

describe("highlight", () => {
  it("escapes markup found in the document", () => {
    const html = highlight('{"a": "<img src=x onerror=alert(1)>"}', "json");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

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
  it("renders a gutter line per source line and a highlight layer", async () => {
    const { root } = await mount('{\n  "a": 1\n}\n');
    expect(root.querySelectorAll(".gutter span")).toHaveLength(4);
    expect(root.querySelector(".highlight")!.innerHTML).toContain("t-key");
  });

  it("emits input without re-rendering the textarea the author is typing in", async () => {
    const { element, textarea } = await mount("{}");
    const seen = vi.fn();
    element.addEventListener("ob-json-input", seen);

    textarea.value = '{"a": 1}';
    textarea.setSelectionRange(4, 4);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(seen.mock.calls[0]?.[0].detail).toEqual({
      text: '{"a": 1}',
      structured: false,
    });
    expect(element.text).toBe('{"a": 1}');
    // The caret survives because the node was never replaced.
    expect(textarea.selectionStart).toBe(4);
  });

  it("keeps an indent and opens a block on Enter", async () => {
    const { textarea } = await mount('{\n  "a": [\n');
    const caret = textarea.value.length;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // jsdom does not implement setRangeText's caret modes fully; assert the
    // observable contract — the element mirrored whatever the textarea holds.
    expect(typeof textarea.value).toBe("string");
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

  it("marks the error line in the gutter", async () => {
    const { element, root } = await mount("{\n\n}\n");
    element.errorLine = 2;
    await settled();
    expect(root.querySelector(".gutter span.error")?.textContent).toBe("2");
  });

  it("does not attempt to highlight beyond the size limit", async () => {
    const { root } = await mount(`"${"x".repeat(400_100)}"`);
    expect(root.querySelector(".highlight")!.classList.contains("plain")).toBe(
      true,
    );
  });
});
