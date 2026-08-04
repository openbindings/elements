import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTERFACE_SOURCES_TAG,
  InterfaceSourcesElement,
} from "./index.js";

if (!customElements.get(INTERFACE_SOURCES_TAG)) {
  customElements.define(INTERFACE_SOURCES_TAG, InterfaceSourcesElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  operations: { list: {}, create: {} },
  sources: {
    api: {
      bindingSpec: "openbindings.openapi@1",
      location: "https://example.com/openapi.json",
      content: { openapi: "3.1.0" },
    },
    embedded: {
      bindingSpec: "example.local@1",
      content: {},
    },
  },
  bindings: {
    "list.api": {
      operation: "list",
      source: "api",
      ref: "#/paths/~1pets/get",
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("InterfaceSourcesElement", () => {
  it("renders source authority and binding provenance without fetching", async () => {
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = obi;
    element.selectedSourceKey = "api";
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelector("dl")?.textContent).toContain(
      "openbindings.openapi@1",
    );
    expect(element.shadowRoot?.querySelector("dl")?.textContent).toContain(
      "Embedded parsed artifact",
    );
    expect(
      element.shadowRoot?.querySelectorAll('[part~="binding"]'),
    ).toHaveLength(1);
  });

  it("emits mutation intent without modifying the supplied interface", async () => {
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = obi;
    element.selectedSourceKey = "api";
    const refresh = vi.fn();
    const remove = vi.fn();
    element.addEventListener("ob-source-refresh", refresh);
    element.addEventListener("ob-binding-remove", remove);
    document.body.append(element);
    await settled();

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-source-action="refresh"]')
      ?.click();
    element.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-binding-remove]")
      ?.click();

    expect(refresh.mock.calls[0]?.[0].detail).toEqual({ sourceKey: "api" });
    expect(remove.mock.calls[0]?.[0].detail).toEqual({
      bindingKey: "list.api",
      sourceKey: "api",
      operationKey: "list",
    });
    expect(obi.sources?.api).toBeDefined();
    expect(obi.bindings?.["list.api"]).toBeDefined();
  });

  it("disables refresh when the source has no location", async () => {
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = obi;
    element.selectedSourceKey = "embedded";
    document.body.append(element);
    await settled();

    expect(
      element.shadowRoot?.querySelector<HTMLButtonElement>(
        '[data-source-action="refresh"]',
      )?.disabled,
    ).toBe(true);
  });

  it("bounds embedded previews without changing supplied source content", async () => {
    const content = "x".repeat(70_000);
    const interfaceDocument = structuredClone(obi);
    interfaceDocument.sources!.embedded!.content = content;
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = interfaceDocument;
    element.selectedSourceKey = "embedded";
    globalThis.document.body.append(element);
    await settled();

    expect(
      element.shadowRoot?.querySelector(".content-preview p")?.textContent,
    ).toContain("Preview truncated");
    expect(
      element.shadowRoot?.querySelector(".content-preview pre")?.textContent
        ?.length,
    ).toBeLessThan(66_000);
    expect(interfaceDocument.sources?.embedded?.content).toBe(content);
  });
});

describe("filter", () => {
  function mount(filter = ""): InterfaceSourcesElement {
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = obi;
    element.filter = filter;
    document.body.append(element);
    return element;
  }

  function sourceKeys(element: InterfaceSourcesElement): string[] {
    return [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>(
        "[data-source-select]",
      ),
    ].map(node => node.dataset.sourceSelect!);
  }

  it("narrows sources by key, bindingSpec, and location, case-insensitively", async () => {
    const element = mount("OPENAPI");
    await settled();
    expect(sourceKeys(element)).toEqual(["api"]);

    element.filter = "example.local";
    await settled();
    expect(sourceKeys(element)).toEqual(["embedded"]);

    element.filter = "example.com";
    await settled();
    expect(sourceKeys(element)).toEqual(["api"]);

    element.filter = "";
    await settled();
    expect(sourceKeys(element)).toEqual(["api", "embedded"]);
  });

  it("keeps a source visible when only one of its bindings matches, and narrows the binding list", async () => {
    // "list" matches the api source only through its binding's operation.
    const element = mount("list");
    await settled();
    expect(sourceKeys(element)).toEqual(["api"]);
    expect(
      element.shadowRoot!.querySelectorAll('[part~="binding"]'),
    ).toHaveLength(1);

    element.filter = "no-such-thing";
    await settled();
    expect(sourceKeys(element)).toEqual([]);
    expect(
      element.shadowRoot!.querySelector(".empty")?.textContent,
    ).toContain("match");
  });

  it("reports filtered counts honestly as N / total", async () => {
    const element = mount("openapi");
    await settled();
    const count = element.shadowRoot!.querySelector(".count")!.textContent!;
    expect(count).toContain("1 / 2 sources");
    expect(count).toContain("1 / 1 binding");

    element.filter = "";
    await settled();
    expect(element.shadowRoot!.querySelector(".count")!.textContent).toBe(
      "2 sources · 1 binding",
    );
  });

  it("falls back to the first visible source when the selection is filtered out", async () => {
    const element = mount("");
    element.selectedSourceKey = "embedded";
    await settled();
    element.filter = "openapi";
    await settled();
    expect(
      element.shadowRoot!.querySelector(".source-detail h3")?.textContent,
    ).toBe("api");
  });
});

describe("flowContent", () => {
  it("reflects the attribute and swaps to the compact sticky Sources heading", async () => {
    const element = document.createElement(
      INTERFACE_SOURCES_TAG,
    ) as InterfaceSourcesElement;
    element.obi = obi;
    document.body.append(element);
    await settled();
    expect(element.flowContent).toBe(false);
    expect(element.shadowRoot!.querySelector("h2")?.textContent).toBe(
      "Sources and bindings",
    );

    element.flowContent = true;
    await settled();
    expect(element.hasAttribute("flow-content")).toBe(true);
    expect(element.shadowRoot!.querySelector("h2")?.textContent).toBe(
      "Sources",
    );

    element.removeAttribute("flow-content");
    await settled();
    expect(element.flowContent).toBe(false);
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
