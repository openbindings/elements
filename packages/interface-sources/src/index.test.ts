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

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
