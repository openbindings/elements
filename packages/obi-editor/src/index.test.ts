import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OBI_EDITOR_TAG, OBIEditorElement } from "./index.js";

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
    expect(element.shadowRoot?.querySelector(".status")?.textContent).toBe(
      "Valid OpenBindings interface",
    );
  });

  it("reports invalid edits and preserves the source text", async () => {
    const element = document.createElement(OBI_EDITOR_TAG) as OBIEditorElement;
    element.value = obi;
    const edited = vi.fn();
    element.addEventListener("ob-interface-edit", edited);
    document.body.append(element);
    await settled();

    const textarea =
      element.shadowRoot?.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("missing editor textarea");
    textarea.value = '{"openbindings":"0.2.0","operations":';
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const detail = edited.mock.calls[0]?.[0].detail;
    expect(detail.valid).toBe(false);
    expect(detail.dirty).toBe(true);
    expect(element.text).toBe(textarea.value);
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

    const textarea =
      element.shadowRoot?.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) throw new Error("missing editor textarea");
    textarea.value = `${element.text}\noperations: {}\n`;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(element.value).toBeNull();
    expect(element.shadowRoot?.querySelector(".status")?.textContent).toContain(
      "Map keys must be unique",
    );
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
