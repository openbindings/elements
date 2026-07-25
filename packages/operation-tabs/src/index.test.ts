import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_TABS_TAG,
  OperationTabsElement,
} from "./index.js";

if (!customElements.get(OPERATION_TABS_TAG)) {
  customElements.define(OPERATION_TABS_TAG, OperationTabsElement);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("OperationTabsElement", () => {
  it("emits activation and close intents without mutating application state", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [{ key: "listPets" }, { key: "createPet" }];
    element.activeKey = "listPets";
    const activate = vi.fn();
    const close = vi.fn();
    element.addEventListener("ob-tab-activate", activate);
    element.addEventListener("ob-tab-close", close);
    document.body.append(element);
    await settled();

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '.tab-button[data-focus-key="createPet"]',
      )
      ?.click();
    element.shadowRoot
      ?.querySelector<HTMLButtonElement>(
        '[data-tab-key="listPets"] .close',
      )
      ?.click();

    expect(activate.mock.calls[0]?.[0].detail).toEqual({ key: "createPet" });
    expect(close.mock.calls[0]?.[0].detail).toEqual({ key: "listPets" });
    expect(element.tabs.map(tab => tab.key)).toEqual([
      "listPets",
      "createPet",
    ]);
  });

  it("supports keyboard navigation, activation, close, and reordering", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [
      { key: "one" },
      { key: "two", running: true },
      { key: "three" },
    ];
    element.activeKey = "one";
    const activate = vi.fn();
    const close = vi.fn();
    const reorder = vi.fn();
    element.addEventListener("ob-tab-activate", activate);
    element.addEventListener("ob-tab-close", close);
    element.addEventListener("ob-tab-reorder", reorder);
    document.body.append(element);
    await settled();

    const one = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '.tab-button[data-focus-key="one"]',
    );
    const two = element.shadowRoot?.querySelector<HTMLButtonElement>(
      '.tab-button[data-focus-key="two"]',
    );
    one?.focus();
    one?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(element.shadowRoot?.activeElement).toBe(two);
    two?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    two?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }),
    );
    two?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));

    expect(activate.mock.calls[0]?.[0].detail).toEqual({ key: "two" });
    expect(reorder.mock.calls[0]?.[0].detail).toEqual({
      keys: ["one", "three", "two"],
    });
    expect(close.mock.calls[0]?.[0].detail).toEqual({ key: "two" });
  });

  it("deduplicates invalid tab identities without choosing an active tab", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [
      { key: " same ", label: "First" },
      { key: "same", label: "Duplicate" },
      { key: " " },
    ];
    document.body.append(element);
    await settled();

    expect(element.tabs).toEqual([{ key: "same", label: "First" }]);
    expect(element.activeKey).toBeNull();
    expect(
      element.shadowRoot?.querySelector('[role="tab"]')?.getAttribute(
        "tabindex",
      ),
    ).toBe("0");
  });

  it("exposes touch-friendly active-tab reordering without mutating tabs", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [{ key: "one" }, { key: "two" }, { key: "three" }];
    element.activeKey = "two";
    const reorder = vi.fn();
    element.addEventListener("ob-tab-reorder", reorder);
    document.body.append(element);
    await settled();

    element.shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-action="move-right"]')
      ?.click();

    expect(reorder.mock.calls[0]?.[0].detail).toEqual({
      keys: ["one", "three", "two"],
    });
    expect(element.tabs.map(tab => tab.key)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
