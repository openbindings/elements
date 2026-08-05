import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSON_EDITOR_TAG, JSONEditorElement } from "@openbindings/json-editor";
import { OBI_EDITOR_TAG, OBIEditorElement } from "./index.js";

// `define.ts` registers both; the tests import classes, so they register the
// composed editor the same way a consumer's define entry point would.
if (!customElements.get(JSON_EDITOR_TAG)) {
  customElements.define(JSON_EDITOR_TAG, JSONEditorElement);
}
if (!customElements.get(OBI_EDITOR_TAG)) {
  customElements.define(OBI_EDITOR_TAG, OBIEditorElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  name: "Example",
  operations: {
    echo: {
      description: "Echo one value",
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("OBIEditorElement", () => {
  it("formats incoming values without emitting application edit intent", async () => {
    const element = document.createElement(OBI_EDITOR_TAG) as OBIEditorElement;
    const edited = vi.fn();
    element.addEventListener("ob-interface-edit", edited);
    element.value = obi;
    document.body.append(element);
    await settled();

    expect(element.text).toContain('"openbindings": "0.2.0"');
    expect(element.value).toEqual(obi);
    expect(edited).not.toHaveBeenCalled();
    // Linter doctrine (rev 17.9): validity is silent — the chip renders
    // only when the document is invalid.
    expect(
      element.shadowRoot?.querySelector<HTMLElement>(".status")?.hidden,
    ).toBe(true);
  });

  it("reports invalid edits and preserves the source text", async () => {
    const element = document.createElement(OBI_EDITOR_TAG) as OBIEditorElement;
    element.value = obi;
    const edited = vi.fn();
    element.addEventListener("ob-interface-edit", edited);
    document.body.append(element);
    await settled();

    const broken = '{"openbindings":"0.2.0","operations":';
    typeInto(element, broken);
    await validated();

    const detail = edited.mock.calls[0]?.[0].detail;
    expect(detail.valid).toBe(false);
    expect(detail.dirty).toBe(true);
    expect(element.text).toBe(broken);
    expect(element.value).toBeNull();
    expect(
      element.shadowRoot?.querySelector(".status")?.getAttribute("data-state"),
    ).toBe("invalid");
  });

  it("converts valid documents to YAML and validates YAML edits", async () => {
    const element = document.createElement(OBI_EDITOR_TAG) as OBIEditorElement;
    element.value = obi;
    document.body.append(element);
    await settled();

    const select =
      element.shadowRoot?.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("missing format select");
    select.value = "yaml";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(element.format).toBe("yaml");
    expect(element.text).toContain("openbindings: 0.2.0");
    expect(element.value).toEqual(obi);

    typeInto(element, `${element.text}\noperations: {}\n`);
    await validated();
    expect(element.value).toBeNull();
    expect(
      element.shadowRoot?.querySelector<HTMLElement>(".status")?.title,
    ).toContain("Map keys must be unique");
  });
});

/** Emulates a keystroke arriving from the composed JSON editor. */
function typeInto(element: OBIEditorElement, text: string): void {
  const editor = element.shadowRoot?.querySelector(".editor");
  if (!editor) throw new Error("missing composed json editor");
  editor.dispatchEvent(
    new CustomEvent("ob-json-input", {
      detail: { text, structured: false },
      bubbles: true,
      composed: true,
    }),
  );
}

/** Waits out the editor's validation debounce. */
async function validated(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 240));
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
