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
  it("renders the operation contract with informational binding rows", async () => {
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

    // Rev 15 (binding roles): the detail list is informational only. The
    // cockpit's binding-select is the single selection surface, so a row is
    // not a button and clicking it selects nothing and emits nothing.
    const row = element.shadowRoot?.querySelector<HTMLElement>(
      '[part~="binding"]',
    );
    expect(row?.textContent).toContain("createPetHTTP");
    expect(row?.closest("button")).toBeNull();
    (row as HTMLElement).click();
    await settled();
    expect(selected).not.toHaveBeenCalled();
    expect(element.selectedBindingKey).toBeNull();
  });
});

describe("OperationDetailElement metadata reconciliation", () => {
  it("renders a tag that collides with the Idempotent flag label", async () => {
    const element = document.createElement(
      OPERATION_DETAIL_TAG,
    ) as OperationDetailElement;
    element.obi = {
      openbindings: "0.2.0",
      name: "Collision",
      operations: {
        touchPet: { idempotent: true, tags: ["Idempotent"] },
      },
    };
    element.operationKey = "touchPet";
    document.body.append(element);
    await settled();

    const flags = [
      ...(element.shadowRoot?.querySelectorAll(".flags span") ?? []),
    ].map(node => node.textContent);
    expect(flags).toEqual(["Idempotent", "Idempotent"]);
    // The render must complete past the metadata row.
    expect(
      element.shadowRoot?.querySelector(".input-schema")?.textContent,
    ).toBe("No input schema");
  });

  it("renders duplicate tags and aliases without aborting the render", async () => {
    const element = document.createElement(
      OPERATION_DETAIL_TAG,
    ) as OperationDetailElement;
    element.obi = {
      openbindings: "0.2.0",
      name: "Duplicates",
      operations: {
        listPets: {
          deprecated: true,
          tags: ["read", "read"],
          aliases: ["pets.list", "pets.list"],
        },
      },
    };
    element.operationKey = "listPets";
    document.body.append(element);
    await settled();

    const flags = [
      ...(element.shadowRoot?.querySelectorAll(".flags span") ?? []),
    ].map(node => node.textContent);
    expect(flags).toEqual(["Deprecated", "read", "read"]);
    const aliases = [
      ...(element.shadowRoot?.querySelectorAll(".alias-list code") ?? []),
    ].map(node => node.textContent);
    expect(aliases).toEqual(["pets.list", "pets.list"]);
    expect(
      element.shadowRoot?.querySelector(".output-schema")?.textContent,
    ).toBe("No output schema");
  });
});

describe("OperationDetailElement bindings disclosure", () => {
  const multiObi: OBInterface = {
    openbindings: "0.2.0",
    name: "Multi",
    operations: {
      listPets: { description: "List pets" },
      getPet: { description: "Get one pet" },
      dropPet: { description: "No bindings at all" },
    },
    sources: {
      api: {
        bindingSpec: "openbindings.openapi@1",
        location: "https://example.test/openapi.json",
      },
      queue: {
        bindingSpec: "openbindings.asyncapi@1",
        location: "https://example.test/asyncapi.json",
      },
      cli: {
        bindingSpec: "openbindings.cli@1",
        location: "https://example.test/cli.json",
      },
    },
    bindings: {
      listPetsCLI: { operation: "listPets", source: "cli", ref: "#/commands/list" },
      listPetsHTTP: { operation: "listPets", source: "api", ref: "#/paths/~1pets/get" },
      listPetsQueue: { operation: "listPets", source: "queue", ref: "#/channels/pets" },
      getPetHTTP: { operation: "getPet", source: "api", ref: "#/paths/~1pets~1{id}/get" },
    },
  };

  function mount(operationKey: string): OperationDetailElement {
    const element = document.createElement(
      OPERATION_DETAIL_TAG,
    ) as OperationDetailElement;
    element.obi = multiObi;
    element.operationKey = operationKey;
    document.body.append(element);
    return element;
  }

  function heading(element: OperationDetailElement): HTMLElement {
    const node = element.shadowRoot?.querySelector<HTMLElement>(
      '[part~="bindings-heading"]',
    );
    if (!node) throw new Error("bindings heading missing");
    return node;
  }

  it("lists bindings as an open list with the count in the heading (rev 17.13)", async () => {
    const element = mount("listPets");
    await settled();

    expect(heading(element).textContent).toBe("Bindings · 3");
    // No disclosure: the list is always visible; the detail region scrolls.
    expect(element.shadowRoot?.querySelector(".bindings details")).toBeNull();
    expect(
      element.shadowRoot?.querySelectorAll(".binding-list [data-binding-key]")
        .length,
    ).toBe(3);
  });

  it("appends the selected key to the summary only when it belongs to this operation", async () => {
    const element = mount("listPets");
    element.selectedBindingKey = "listPetsHTTP";
    await settled();

    expect(heading(element).textContent).toBe("Bindings · 3 · via listPetsHTTP");

    element.selectedBindingKey = "getPetHTTP";
    await settled();
    expect(heading(element).textContent).toBe("Bindings · 3");
  });

  it("renders informational rows inside the disclosure and highlights the host's selection", async () => {
    const element = mount("listPets");
    const selected = vi.fn();
    element.addEventListener("ob-binding-select", selected);
    await settled();

    const row = element.shadowRoot?.querySelector<HTMLElement>(
      '.bindings [part~="binding"][data-binding-key="listPetsQueue"]',
    );
    expect(row).toBeTruthy();
    expect(row?.querySelector(".binding-family")?.textContent).toContain(
      "openbindings.asyncapi@1",
    );
    // No selection affordance: clicking a row emits nothing.
    row?.click();
    await settled();
    expect(selected).not.toHaveBeenCalled();
    expect(element.selectedBindingKey).toBeNull();

    // The host-assigned selection is a display-only highlight.
    element.selectedBindingKey = "listPetsQueue";
    await settled();
    expect(row?.classList.contains("selected")).toBe(true);
    expect(heading(element).textContent).toBe("Bindings · 3 · via listPetsQueue");
  });

  it("hides the bindings section entirely when the operation has no bindings", async () => {
    const element = mount("dropPet");
    await settled();

    expect(
      element.shadowRoot?.querySelector<HTMLElement>(".bindings")?.hidden,
    ).toBe(true);
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
