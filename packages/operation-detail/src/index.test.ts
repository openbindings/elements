import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_DETAIL_TAG,
  OperationDetailElement,
} from "./index.js";

if (!customElements.get(OPERATION_DETAIL_TAG)) {
  customElements.define(OPERATION_DETAIL_TAG, OperationDetailElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  name: "Example",
  operations: {
    createPet: {
      description: "Create one pet",
      aliases: ["pets.create"],
      tags: ["write"],
      input: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      output: { type: "object" },
      examples: {
        minimal: {
          description: "A pet with no optional fields",
          input: { name: "Pip" },
          output: null,
        },
      },
    },
  },
  sources: {
    api: {
      bindingSpec: "openbindings.openapi@1",
      location: "https://example.test/openapi.json",
    },
  },
  bindings: {
    createPetHTTP: {
      operation: "createPet",
      source: "api",
      ref: "#/paths/~1pets/post",
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("OperationDetailElement", () => {
  it("renders the operation contract and emits binding intent", async () => {
    const element = document.createElement(
      OPERATION_DETAIL_TAG,
    ) as OperationDetailElement;
    const selected = vi.fn();
    element.obi = obi;
    element.operationKey = "createPet";
    element.addEventListener("ob-binding-select", selected);
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelector("h2")?.textContent).toBe(
      "createPet",
    );
    expect(
      element.shadowRoot?.querySelector(".alias-list")?.textContent,
    ).toContain("pets.create");
    expect(
      element.shadowRoot?.querySelector(".input-schema")?.textContent,
    ).toContain('"name"');
    expect(
      element.shadowRoot?.querySelector(".example-list")?.textContent,
    ).toContain('"Pip"');
    expect(
      element.shadowRoot?.querySelector(".example-list")?.textContent,
    ).toContain("null");

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>('[part~="binding"]')
      ?.click();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(
      (selected.mock.calls[0]?.[0] as CustomEvent).detail.bindingKey,
    ).toBe("createPetHTTP");
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
