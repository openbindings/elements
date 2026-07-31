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

// Sorted render order: a.first, b.second, c.third, d.fourth.
const rich: OBInterface = {
  openbindings: "0.2.0",
  name: "Rich",
  operations: {
    "a.first": { description: "Alpha" },
    "b.second": { description: "Beta", deprecated: true },
    "c.third": { description: "Gamma", aliases: ["legacyThird"] },
    "d.fourth": { description: "Delta", tags: ["write"] },
  },
};

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  FakeResizeObserver.instances = [];
});

async function mount(document_: OBInterface): Promise<OBIExplorerElement> {
  const element = document.createElement(OBI_EXPLORER_TAG) as OBIExplorerElement;
  element.obi = document_;
  document.body.append(element);
  await settled();
  return element;
}

function buttonsOf(element: OBIExplorerElement): HTMLButtonElement[] {
  return [
    ...element.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      '[part~="operation"]',
    ),
  ];
}

function type(element: OBIExplorerElement, value: string): void {
  const input = element.shadowRoot!.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(target: Element, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("OBIExplorerElement", () => {
  it("renders and selects operations without an external capability", async () => {
    const element = document.createElement(OBI_EXPLORER_TAG) as OBIExplorerElement;
    element.obi = obi;
    const selected = vi.fn();
    element.addEventListener("ob-operation-select", selected);
    document.body.append(element);
    await settled();

    expect(element.shadowRoot?.querySelector("h2")?.textContent).toBe("Example");
    const buttons = buttonsOf(element);
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

describe("keyboard listbox", () => {
  it("keeps the operation list a single Tab stop via roving tabindex", async () => {
    const element = await mount(rich);
    const buttons = buttonsOf(element);
    expect(buttons).toHaveLength(4);
    expect(buttons.map(button => button.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("moves focus with arrows, Home and End without selecting, and does not wrap", async () => {
    const element = await mount(rich);
    const selected = vi.fn();
    element.addEventListener("ob-operation-select", selected);
    const buttons = buttonsOf(element);

    buttons[0]!.focus();
    press(buttons[0]!, "ArrowDown");
    expect(element.shadowRoot!.activeElement).toBe(buttons[1]);
    expect(buttons.map(button => button.tabIndex)).toEqual([-1, 0, -1, -1]);

    press(buttons[1]!, "ArrowUp");
    expect(element.shadowRoot!.activeElement).toBe(buttons[0]);
    // No wrap at either edge.
    press(buttons[0]!, "ArrowUp");
    expect(element.shadowRoot!.activeElement).toBe(buttons[0]);
    press(buttons[0]!, "End");
    expect(element.shadowRoot!.activeElement).toBe(buttons[3]);
    press(buttons[3]!, "ArrowDown");
    expect(element.shadowRoot!.activeElement).toBe(buttons[3]);
    press(buttons[3]!, "Home");
    expect(element.shadowRoot!.activeElement).toBe(buttons[0]);

    // Moving focus never selects.
    expect(element.selectedOperation).toBeNull();
    expect(selected).not.toHaveBeenCalled();
  });

  it("activates the focused row with Enter and Space through the click path", async () => {
    const element = await mount(rich);
    const selected = vi.fn();
    element.addEventListener("ob-operation-select", selected);
    const buttons = buttonsOf(element);

    buttons[0]!.focus();
    press(buttons[0]!, "ArrowDown");
    press(buttonsOf(element)[1]!, "Enter");
    await settled();
    expect(element.selectedOperation).toBe("b.second");
    expect(selected).toHaveBeenCalledTimes(1);

    press(buttonsOf(element)[1]!, "ArrowDown");
    press(buttonsOf(element)[2]!, " ");
    await settled();
    expect(element.selectedOperation).toBe("c.third");
    expect(selected).toHaveBeenCalledTimes(2);
  });

  it("enters the list from the filter input with ArrowDown", async () => {
    const element = await mount(rich);
    const input = element.shadowRoot!.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    input.focus();
    press(input, "ArrowDown");
    expect(element.shadowRoot!.activeElement).toBe(buttonsOf(element)[0]);
  });

  it("moves the roving stop to the first visible row when the focused row is filtered out, without stealing focus", async () => {
    const element = await mount(rich);
    const buttons = buttonsOf(element);
    buttons[0]!.focus();
    press(buttons[0]!, "End"); // focus memory on d.fourth... then filter it away
    press(buttonsOf(element)[3]!, "ArrowUp"); // focus c.third
    expect(element.shadowRoot!.activeElement?.closest("li")?.dataset.obKey).toBe(
      "c.third",
    );

    const input = element.shadowRoot!.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    input.focus();
    type(element, "write"); // only d.fourth remains; c.third is gone
    await settled();

    const visible = buttonsOf(element);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.tabIndex).toBe(0);
    // Typing must not lose focus to the list.
    expect(element.shadowRoot!.activeElement).toBe(input);
  });
});

describe("deprecated operations", () => {
  it("renders a chip, mutes the summary, and extends the accessible name", async () => {
    const element = await mount(rich);
    const row = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "b.second")!;

    expect(row.classList.contains("deprecated")).toBe(true);
    const chip = row.querySelector<HTMLElement>(".tags .deprecated-chip");
    expect(chip?.textContent).toBe("deprecated");
    // The chip is decorative; the sr-only note carries the semantics.
    expect(chip?.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".deprecated-note")?.textContent).toBe(
      ", deprecated",
    );

    const fresh = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "a.first")!;
    expect(fresh.classList.contains("deprecated")).toBe(false);
    expect(fresh.querySelector(".deprecated-chip")).toBeNull();
    expect(fresh.querySelector(".deprecated-note")?.textContent).toBe("");

    // Deprecated operations stay selectable.
    row.querySelector("button")!.click();
    await settled();
    expect(element.selectedOperation).toBe("b.second");
  });
});

describe("count and filter announcement", () => {
  it("shows N / total while filtering and announces count changes politely", async () => {
    const element = await mount(rich);
    const count = element.shadowRoot!.querySelector(".count")!;
    const status = element.shadowRoot!.querySelector('[role="status"]')!;
    expect(count.textContent).toBe("4");
    expect(status.textContent).toBe("");

    type(element, "write");
    await settled();
    expect(count.textContent).toBe("1 / 4");
    expect(status.textContent).toBe("1 of 4 operations shown");

    type(element, "");
    await settled();
    expect(count.textContent).toBe("4");
    expect(status.textContent).toBe("");
  });

  it("does not re-announce keystrokes that leave the count unchanged", async () => {
    const element = await mount(rich);
    type(element, "writ");
    await settled();
    const status = element.shadowRoot!.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("1 of 4 operations shown");

    const observer = new MutationObserver(() => {});
    observer.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    type(element, "write");
    await settled();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });
});

describe("selection part token", () => {
  it("exposes operation-selected as a dynamic part on the selected row", async () => {
    const element = await mount(rich);
    buttonsOf(element)[0]!.click();
    await settled();

    const buttons = buttonsOf(element);
    expect(buttons[0]!.getAttribute("part")).toBe(
      "operation operation-selected",
    );
    expect(buttons[0]!.getAttribute("aria-current")).toBe("true");
    expect(buttons[1]!.getAttribute("part")).toBe("operation");
  });
});

describe("alias match hint", () => {
  it("shows the matching alias when it is the only reason a row is visible", async () => {
    const element = await mount(rich);
    element.filter = "legacy";
    await settled();

    const buttons = buttonsOf(element);
    expect(buttons).toHaveLength(1);
    const hint = buttons[0]!.querySelector<HTMLElement>(".alias-hint")!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe("alias: legacyThird");
  });

  it("shows no hint when the key also matches, or when no filter is active", async () => {
    const element = await mount(rich);
    element.filter = "third"; // matches both the key c.third and the alias
    await settled();
    const filtered = buttonsOf(element);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.querySelector<HTMLElement>(".alias-hint")!.hidden).toBe(
      true,
    );

    element.filter = "";
    await settled();
    for (const button of buttonsOf(element)) {
      expect(button.querySelector<HTMLElement>(".alias-hint")!.hidden).toBe(true);
    }
  });
});

describe("interface description clamping", () => {
  it("shows the toggle for a mid-length description once the clamp actually overflows", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // Well under the old 180-character heuristic, yet visually clamped.
    const element = await mount({
      ...rich,
      description: "Short but wide enough to clamp at four lines. ".repeat(2),
    });
    const description = element.shadowRoot!.querySelector<HTMLElement>(
      ".description",
    )!;
    const toggle = element.shadowRoot!.querySelector<HTMLButtonElement>(
      ".description-toggle",
    )!;
    expect(toggle.hidden).toBe(true);

    Object.defineProperty(description, "scrollHeight", { value: 96 });
    Object.defineProperty(description, "clientHeight", { value: 64 });
    const observer = FakeResizeObserver.instances.find(instance =>
      instance.observed.includes(description),
    );
    expect(observer).toBeDefined();
    observer!.fire();
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe("Show more");

    toggle.click();
    await settled();
    expect(description.classList.contains("expanded")).toBe(true);
    expect(toggle.textContent).toBe("Show less");
    expect(toggle.hidden).toBe(false);
  });

  it("hides the toggle for long text that does not overflow its clamp", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const element = await mount({
      ...rich,
      // Over the old character heuristic; the measured clamp does not overflow.
      description: "A deliberately detailed interface description. ".repeat(8),
    });
    const toggle = element.shadowRoot!.querySelector<HTMLButtonElement>(
      ".description-toggle",
    )!;
    expect(toggle.hidden).toBe(true);
  });
});

describe("ob-filter-change", () => {
  it("emits when the user's typing changes the visible results", async () => {
    const element = await mount(rich);
    const changed = vi.fn();
    element.addEventListener("ob-filter-change", changed);

    type(element, "write");
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      filter: "write",
      visibleCount: 1,
      totalCount: 4,
    });
  });

  it("does not emit when typing leaves the results unchanged", async () => {
    const element = await mount(rich);
    const changed = vi.fn();
    element.addEventListener("ob-filter-change", changed);

    type(element, "writ");
    await settled();
    type(element, "write"); // same single visible row
    await settled();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("never echoes programmatic filter assignment", async () => {
    const element = await mount(rich);
    const changed = vi.fn();
    element.addEventListener("ob-filter-change", changed);

    element.filter = "alpha";
    await settled();
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("programmatic selection scrolling", () => {
  it("scrolls the selected row into view on assignment but not on user clicks", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const element = await mount(rich);
    expect(scrollIntoView).not.toHaveBeenCalled();

    element.selectedOperation = "c.third";
    await settled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    buttonsOf(element)[0]!.click();
    await settled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("row cache", () => {
  it("reuses row nodes across a filter round-trip for the same document", async () => {
    const element = await mount(rich);
    const before = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "a.first")!;

    type(element, "write"); // a.first leaves the DOM
    await settled();
    expect(
      [...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]")]
        .some(item => item.dataset.obKey === "a.first"),
    ).toBe(false);

    type(element, "");
    await settled();
    const after = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "a.first")!;
    expect(after).toBe(before);
  });

  it("invalidates the cache when the document identity changes", async () => {
    const element = await mount(rich);
    const before = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "b.second")!;
    type(element, "write"); // detach b.second into the cache
    await settled();
    expect(
      element.shadowRoot!.querySelectorAll("li[data-ob-key]"),
    ).toHaveLength(1);

    element.obi = structuredClone(rich);
    element.filter = "";
    await settled();
    const after = [
      ...element.shadowRoot!.querySelectorAll<HTMLElement>("li[data-ob-key]"),
    ].find(item => item.dataset.obKey === "b.second")!;
    // A detached node cached for the previous document must not resurface.
    expect(after).not.toBe(before);
  });
});

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
