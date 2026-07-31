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
    await settled();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(element.selectedBindingKey).toBe("createPetHTTP");
    expect(
      element.shadowRoot?.querySelector('[part~="binding"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      (selected.mock.calls[0]?.[0] as CustomEvent).detail.bindingKey,
    ).toBe("createPetHTTP");
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

  function details(element: OperationDetailElement): HTMLDetailsElement {
    const node = element.shadowRoot?.querySelector<HTMLDetailsElement>(
      ".bindings details",
    );
    if (!node) throw new Error("bindings details missing");
    return node;
  }

  function summary(element: OperationDetailElement): HTMLElement {
    const node = element.shadowRoot?.querySelector<HTMLElement>(
      '[part~="bindings-summary"]',
    );
    if (!node) throw new Error("bindings summary missing");
    return node;
  }

  it("shows the binding count in the summary and defaults closed at three bindings", async () => {
    const element = mount("listPets");
    await settled();

    expect(summary(element).textContent).toBe("Bindings · 3");
    expect(details(element).open).toBe(false);
  });

  it("defaults open at two or fewer bindings", async () => {
    const element = mount("getPet");
    await settled();

    expect(summary(element).textContent).toBe("Bindings · 1");
    expect(details(element).open).toBe(true);
  });

  it("appends the selected key to the summary only when it belongs to this operation", async () => {
    const element = mount("listPets");
    element.selectedBindingKey = "listPetsHTTP";
    await settled();

    expect(summary(element).textContent).toBe("Bindings · 3 · via listPetsHTTP");

    element.selectedBindingKey = "getPetHTTP";
    await settled();
    expect(summary(element).textContent).toBe("Bindings · 3");
  });

  it("keeps rows clickable inside the disclosure with an unchanged payload", async () => {
    const element = mount("listPets");
    const selected = vi.fn();
    element.addEventListener("ob-binding-select", selected);
    await settled();

    const row = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '.bindings details [part~="binding"][data-binding-key="listPetsQueue"]',
    );
    expect(row).toBeTruthy();
    row?.click();
    await settled();

    expect(selected).toHaveBeenCalledTimes(1);
    const detail = (selected.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail.bindingKey).toBe("listPetsQueue");
    expect(detail.binding).toBe(multiObi.bindings?.listPetsQueue);
    expect(row?.getAttribute("aria-pressed")).toBe("true");
    expect(summary(element).textContent).toBe("Bindings · 3 · via listPetsQueue");
  });

  it("preserves a manual toggle and row focus across selectedBindingKey re-renders", async () => {
    const element = mount("listPets");
    await settled();

    // User opens the disclosure the render pass defaulted closed.
    details(element).open = true;
    const row = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-binding-key="listPetsCLI"]',
    );
    row?.focus();

    element.selectedBindingKey = "listPetsHTTP";
    await settled();
    expect(details(element).open).toBe(true);
    expect(element.shadowRoot?.activeElement).toBe(row);

    // And the converse: a manual close on an open-by-default operation.
    const other = mount("getPet");
    await settled();
    details(other).open = false;
    other.selectedBindingKey = "getPetHTTP";
    await settled();
    expect(details(other).open).toBe(false);
  });

  it("re-applies the default open state when the operation changes", async () => {
    const element = mount("listPets");
    await settled();
    details(element).open = true;

    element.operationKey = "getPet";
    await settled();
    expect(details(element).open).toBe(true);

    element.operationKey = "listPets";
    await settled();
    expect(details(element).open).toBe(false);
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
