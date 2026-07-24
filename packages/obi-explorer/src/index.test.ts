import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OBI_EXPLORER_TAG, OBIExplorerElement } from "./index.js";

if (!customElements.get(OBI_EXPLORER_TAG)) {
  customElements.define(OBI_EXPLORER_TAG, OBIExplorerElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  name: "Example",
  operations: {
    listPets: {
      description: "List the available pets",
      tags: ["pets"],
    },
    createPet: {
      description: "Create one pet",
      tags: ["pets", "write"],
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("OBIExplorerElement", () => {
  it("renders and selects operations without an external capability", async () => {
    const element = document.createElement(OBI_EXPLORER_TAG) as OBIExplorerElement;
    element.obi = obi;
    const selected = vi.fn();
    element.addEventListener("ob-operation-select", selected);
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelector("h2")?.textContent).toBe("Example");
    const buttons = [
      ...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '[part~="operation"]',
      ) ?? []),
    ];
    expect(buttons).toHaveLength(2);
    buttons.find(button => button.textContent?.includes("createPet"))?.click();
    await settled();

    expect(element.selectedOperation).toBe("createPet");
    expect(selected).toHaveBeenCalledTimes(1);
    expect(
      (selected.mock.calls[0]?.[0] as CustomEvent).detail.operationKey,
    ).toBe("createPet");
  });

  it("filters keys, descriptions, aliases, and tags", async () => {
    const element = document.createElement(OBI_EXPLORER_TAG) as OBIExplorerElement;
    element.obi = obi;
    element.filter = "write";
    document.body.append(element);
    await settled();

    const buttons = element.shadowRoot?.querySelectorAll('[part~="operation"]');
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]?.textContent).toContain("createPet");
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
