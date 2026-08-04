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
    one?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(element.shadowRoot?.activeElement).toBe(two);
    two?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    two?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
      }),
    );
    two?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));

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

  it("keeps a keyboard entry point when activeKey matches no tab", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [{ key: "a" }, { key: "b" }];
    element.activeKey = "gone";
    document.body.append(element);
    await settled();

    const stops = [
      ...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      ) ?? []),
    ].map(button => button.tabIndex);
    expect(stops).toContain(0);
    // Still a single stop, per the ARIA tabs pattern.
    expect(stops.filter(stop => stop === 0)).toHaveLength(1);
  });

  it("keeps close buttons out of the tab order but discoverable", async () => {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = [{ key: "a", label: "Alpha" }, { key: "b" }];
    element.activeKey = "a";
    document.body.append(element);
    await settled();

    const closes = [
      ...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>(".close") ??
        []),
    ];
    expect(closes).toHaveLength(2);
    for (const close of closes) expect(close.tabIndex).toBe(-1);
    expect(closes[0]?.getAttribute("aria-label")).toBe(
      "Close Alpha, Delete closes",
    );
    expect(closes[1]?.getAttribute("aria-label")).toBe(
      "Close b, Delete closes",
    );
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

describe("workspace-item tabs (rev 16)", () => {
  function mount(tabs: OperationTabsElement["tabs"]): OperationTabsElement {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = tabs;
    document.body.append(element);
    return element;
  }

  it("renders the kind as a muted subtitle line under the label", async () => {
    const element = mount([
      { key: "s1", label: "placeOrder", kind: "operation" },
      { key: "s2", label: "openapi", kind: "source" },
      { key: "s3", label: "plain" },
    ]);
    await settled();

    const kinds = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>(".tab-shell"),
    ].map(shell => {
      const kind = shell.querySelector<HTMLElement>(".kind");
      return kind && !kind.hidden ? kind.textContent : null;
    });
    expect(kinds).toEqual(["operation", "source", null]);
  });

  it("renames through an inline edit: F2 begins, Enter commits, Esc cancels", async () => {
    const element = mount([{ key: "s1", label: "placeOrder" }]);
    element.activeKey = "s1";
    const renamed = vi.fn();
    element.addEventListener("ob-tab-rename", renamed);
    await settled();

    const button = element.shadowRoot!.querySelector<HTMLButtonElement>(
      '.tab-button[data-focus-key="s1"]',
    )!;
    button.focus();
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
    );
    await settled();
    const input = element.shadowRoot!.querySelector<HTMLInputElement>(
      ".rename-input",
    )!;
    expect(input).toBeTruthy();
    expect(input.value).toBe("placeOrder");

    input.value = "order · smoke";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settled();
    expect(renamed).toHaveBeenCalledTimes(1);
    expect(renamed.mock.calls[0]?.[0].detail).toEqual({
      key: "s1",
      label: "order · smoke",
    });
    expect(element.shadowRoot!.querySelector(".rename-input")).toBeNull();

    // Esc cancels without an event.
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
    );
    await settled();
    const second = element.shadowRoot!.querySelector<HTMLInputElement>(
      ".rename-input",
    )!;
    second.value = "discarded";
    second.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settled();
    expect(renamed).toHaveBeenCalledTimes(1);
    expect(element.shadowRoot!.querySelector(".rename-input")).toBeNull();
  });

  it("begins a rename on label double-click and refuses an empty commit", async () => {
    const element = mount([{ key: "s1", label: "one" }]);
    const renamed = vi.fn();
    element.addEventListener("ob-tab-rename", renamed);
    await settled();

    element.shadowRoot!
      .querySelector<HTMLElement>('[data-tab-key="s1"] .label')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true }));
    await settled();
    const input = element.shadowRoot!.querySelector<HTMLInputElement>(
      ".rename-input",
    )!;
    expect(input).toBeTruthy();
    input.value = "   ";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settled();
    // An all-whitespace label is a cancel, not a rename to nothing.
    expect(renamed).not.toHaveBeenCalled();
    expect(element.shadowRoot!.querySelector(".rename-input")).toBeNull();
  });

  it("offers Duplicate tab in the action menu for the active tab", async () => {
    const element = mount([{ key: "s1" }, { key: "s2" }]);
    element.activeKey = "s2";
    const duplicated = vi.fn();
    element.addEventListener("ob-tab-duplicate", duplicated);
    await settled();

    element.shadowRoot!
      .querySelector<HTMLButtonElement>('[data-action="duplicate"]')!
      .click();
    expect(duplicated.mock.calls[0]?.[0].detail).toEqual({ key: "s2" });
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("OperationTabsElement overflow affordances", () => {
  /**
   * jsdom performs no layout, so scroll geometry is stubbed. The logic under
   * test is the mapping from geometry to behaviour, which is exactly what
   * broke: an overflowing strip that offered no way to reach the hidden tabs.
   */
  function stubGeometry(
    list: HTMLElement,
    { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number },
  ): void {
    Object.defineProperty(list, "scrollWidth", {
      configurable: true,
      get: () => scrollWidth,
    });
    Object.defineProperty(list, "clientWidth", {
      configurable: true,
      get: () => clientWidth,
    });
  }

  async function mount(): Promise<{
    element: OperationTabsElement;
    list: HTMLElement;
    container: HTMLElement;
  }> {
    const element = document.createElement(
      OPERATION_TABS_TAG,
    ) as OperationTabsElement;
    element.tabs = Array.from({ length: 12 }, (_, i) => ({ key: `op${i}` }));
    element.activeKey = "op0";
    document.body.append(element);
    await settled();
    const root = element.shadowRoot!;
    return {
      element,
      list: root.querySelector(".tab-list")!,
      container: root.querySelector(".container")!,
    };
  }

  it("turns a vertical wheel into horizontal scrolling when it overflows", async () => {
    const { list } = await mount();
    stubGeometry(list, { scrollWidth: 2000, clientWidth: 500 });
    list.scrollLeft = 0;

    list.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 180, bubbles: true, cancelable: true }),
    );

    expect(list.scrollLeft).toBe(180);
  });

  it("leaves horizontal intent and non-overflowing strips alone", async () => {
    const { list } = await mount();

    stubGeometry(list, { scrollWidth: 400, clientWidth: 500 });
    list.scrollLeft = 0;
    list.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 180, bubbles: true, cancelable: true }),
    );
    expect(list.scrollLeft).toBe(0);

    // A trackpad swipe already scrolls horizontally; hijacking it would double.
    stubGeometry(list, { scrollWidth: 2000, clientWidth: 500 });
    list.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 200,
        deltaY: 40,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(list.scrollLeft).toBe(0);
  });

  it("reports which edges hide tabs so they can be faded", async () => {
    const { element, list, container } = await mount();
    stubGeometry(list, { scrollWidth: 2000, clientWidth: 500 });

    list.scrollLeft = 0;
    list.dispatchEvent(new Event("scroll"));
    expect(container.getAttribute("data-overflow")).toBe("end");

    list.scrollLeft = 700;
    list.dispatchEvent(new Event("scroll"));
    expect(container.getAttribute("data-overflow")).toBe("both");

    list.scrollLeft = 1500;
    list.dispatchEvent(new Event("scroll"));
    expect(container.getAttribute("data-overflow")).toBe("start");

    stubGeometry(list, { scrollWidth: 400, clientWidth: 500 });
    list.scrollLeft = 0;
    list.dispatchEvent(new Event("scroll"));
    expect(container.getAttribute("data-overflow")).toBe("none");

    element.remove();
  });
});
