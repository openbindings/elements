import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_DETAIL_TAG, SourceDetailElement, type SourceInspection } from "./index.js";

if (!customElements.get(SOURCE_DETAIL_TAG)) {
  customElements.define(SOURCE_DETAIL_TAG, SourceDetailElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  name: "Example",
  operations: {
    createPet: { description: "Create one pet" },
    listPets: { description: "List pets" },
  },
  sources: {
    api: {
      bindingSpec: "openbindings.openapi@1",
      location: "https://example.test/openapi.json",
    },
    embedded: {
      bindingSpec: "openbindings.openapi@1",
      content: { openapi: "3.1.0", paths: {} },
    },
  },
  bindings: {
    createPetHTTP: {
      operation: "createPet",
      source: "api",
      selector: "#/paths/~1pets/post",
    },
    listPetsHTTP: {
      operation: "listPets",
      source: "api",
      selector: "#/paths/~1pets/get",
    },
  },
};

function mount(): SourceDetailElement {
  const element = document.createElement(
    SOURCE_DETAIL_TAG,
  ) as SourceDetailElement;
  document.body.append(element);
  return element;
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("SourceDetailElement", () => {
  it("renders the source facts and its bindings, and emits verb intents", async () => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "api";
    await settled();

    const root = element.shadowRoot!;
    expect(root.querySelector("h2")?.textContent).toBe("api");
    expect(root.querySelector(".spec")?.textContent).toBe(
      "openbindings.openapi@1",
    );
    expect(root.querySelector(".location")?.textContent).toContain(
      "example.test",
    );
    expect(root.querySelectorAll(".binding-list li")).toHaveLength(2);

    const pulled = vi.fn();
    const removed = vi.fn();
    const inspected = vi.fn();
    element.addEventListener("ob-source-pull", event =>
      pulled(event.detail.sourceKey),
    );
    element.addEventListener("ob-source-remove", event =>
      removed(event.detail.sourceKey),
    );
    element.addEventListener("ob-source-inspect", event =>
      inspected(event.detail.sourceKey),
    );
    root.querySelector<HTMLButtonElement>(".pull")!.click();
    root.querySelector<HTMLButtonElement>(".remove")!.click();
    root.querySelector<HTMLButtonElement>(".inspect")!.click();
    expect(pulled).toHaveBeenCalledWith("api");
    expect(removed).toHaveBeenCalledWith("api");
    expect(inspected).toHaveBeenCalledWith("api");
  });

  it("emits binding navigation and unbind intents from the binding rows", async () => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "api";
    await settled();

    const selected = vi.fn();
    const removed = vi.fn();
    element.addEventListener("ob-binding-select", event =>
      selected(event.detail),
    );
    element.addEventListener("ob-binding-remove", event =>
      removed(event.detail),
    );
    const root = element.shadowRoot!;
    root
      .querySelector<HTMLButtonElement>(
        '[data-binding-key="createPetHTTP"] .binding-select',
      )!
      .click();
    expect(selected).toHaveBeenCalledWith({
      bindingKey: "createPetHTTP",
      sourceKey: "api",
      operationKey: "createPet",
    });
    root
      .querySelector<HTMLButtonElement>(
        '[data-binding-key="listPetsHTTP"] .binding-remove',
      )!
      .click();
    expect(removed).toHaveBeenCalledWith({
      bindingKey: "listPetsHTTP",
      sourceKey: "api",
      operationKey: "listPets",
    });
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it("disables Pull for embedded-only sources and while a pull is in flight", async () => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "embedded";
    await settled();
    const pull = element.shadowRoot!.querySelector<HTMLButtonElement>(".pull")!;
    expect(pull.disabled).toBe(true);

    element.sourceKey = "api";
    await settled();
    expect(pull.disabled).toBe(false);
    element.pulling = true;
    await settled();
    expect(pull.disabled).toBe(true);
    expect(pull.textContent).toContain("Pulling");
  });

  it("renders a host-assigned inspection and clears it when the source changes", async () => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "api";
    element.inspection = {
      targets: [
        { selector: "#/paths/~1pets/post", operationKey: "createPet" },
        { selector: "#/paths/~1pets/get" },
      ],
      exhaustive: false,
      limitation: { code: "sampled", message: "only sampled paths listed" },
    };
    await settled();

    const root = element.shadowRoot!;
    const inspection = root.querySelector<HTMLElement>(".inspection")!;
    expect(inspection.hidden).toBe(false);
    expect(root.querySelectorAll(".target-list li")).toHaveLength(2);
    expect(
      root.querySelector(".inspection-limitation")?.textContent,
    ).toContain("only sampled paths listed");

    element.sourceKey = "embedded";
    await settled();
    expect(inspection.hidden).toBe(true);
  });

  it("requires an inspection selector in the public type", () => {
    // @ts-expect-error Source Inspector requires a selector even without operation framing.
    const missing: NonNullable<SourceInspection["targets"]>[number] = {};
    expect(missing).toEqual({});
    const empty: NonNullable<SourceInspection["targets"]>[number] = { selector: "" };
    expect(empty.selector).toBe("");
  });

  it("renders inspection selectors without interpreting or rewriting them", async () => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "api";
    const targets = [{ selector: "" }, { selector: "  opaque/<target>  " }];
    element.inspection = { targets, exhaustive: true };
    await settled();
    expect(Array.from(element.shadowRoot!.querySelectorAll(".target-list code"), node => node.textContent))
      .toEqual(['"" (empty selector)', "  opaque/<target>  "]);
    expect(targets).toEqual([{ selector: "" }, { selector: "  opaque/<target>  " }]);
  });

  it.each([
    [{}, "Invalid inspection target: missing selector"],
    [{ selector: null }, "Invalid inspection target: selector must be a string"],
    [{ selector: 0 }, "Invalid inspection target: selector must be a string"],
    [{ selector: false }, "Invalid inspection target: selector must be a string"],
  ])("shows malformed inspection selectors without inventing a target: %j", async (target, message) => {
    const element = mount();
    element.obi = obi;
    element.sourceKey = "api";
    // Exercise untyped external data, not a conforming inspector implementation.
    element.inspection = JSON.parse(JSON.stringify({ targets: [target], exhaustive: true }));
    await settled();
    expect(element.shadowRoot!.querySelector(".target-list code")?.textContent).toBe(message);
    element.inspection = { targets: [{ selector: "" }], exhaustive: true };
    await settled();
    expect(element.shadowRoot!.querySelector(".target-list code")?.textContent).toBe('"" (empty selector)');
  });

  it("distinguishes omitted and empty binding selectors without declaring their meaning", async () => {
    const element = mount();
    const document = structuredClone(obi);
    delete document.bindings!.createPetHTTP!.selector;
    document.bindings!.listPetsHTTP!.selector = "";
    element.obi = document;
    element.sourceKey = "api";
    await settled();
    expect(Array.from(element.shadowRoot!.querySelectorAll(".binding-list code"), node => node.textContent))
      .toEqual(["Selector omitted", '"" (empty selector)']);
    expect(document.bindings!.createPetHTTP).not.toHaveProperty("selector");
    expect(document.bindings!.listPetsHTTP!.selector).toBe("");
  });

  it("explains the empty states honestly", async () => {
    const element = mount();
    await settled();
    const empty = element.shadowRoot!.querySelector(".empty")!;
    expect(empty.textContent).toContain("Assign an OBI document");

    element.obi = obi;
    element.sourceKey = "missing";
    await settled();
    expect(empty.textContent).toContain("Select a source");
  });
});
