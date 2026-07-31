import { describe, expect, it } from "vitest";
import { Refs, debounce, reconcile, renderShell } from "./render.js";

function container(): HTMLElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}

describe("reconcile", () => {
  it("reuses nodes for surviving keys so focus and state persist", () => {
    const list = container();
    const create = (key: string): HTMLElement => {
      const node = document.createElement("div");
      node.append(document.createElement("input"));
      node.dataset.created = key;
      return node;
    };

    reconcile(list, ["a", "b", "c"], { key: item => item, create });
    const before = list.children[1] as HTMLElement;
    const input = before.querySelector("input")!;
    input.value = "typed";
    input.focus();

    reconcile(list, ["c", "b", "a"], { key: item => item, create });

    // Node identity is the mechanism: because the element is moved rather
    // than recreated, everything hanging off it — value, selection, scroll,
    // listeners, and focus in a real browser — comes along. jsdom drops focus
    // on any move, so identity and value are what can be asserted here.
    expect(list.children[1]).toBe(before);
    expect(before.querySelector("input")).toBe(input);
    expect(input.value).toBe("typed");
    expect(input.isConnected).toBe(true);
    expect([...list.children].map(node => node.getAttribute("data-ob-key"))).toEqual(
      ["c", "b", "a"],
    );
  });

  it("creates, updates and destroys only what changed", () => {
    const list = container();
    const created: string[] = [];
    const destroyed: string[] = [];
    const options = {
      key: (item: string) => item,
      create: (item: string) => {
        created.push(item);
        return document.createElement("div");
      },
      update: (node: HTMLElement, item: string) => {
        node.textContent = item.toUpperCase();
      },
      destroy: (_node: HTMLElement, key: string) => {
        destroyed.push(key);
      },
    };

    reconcile(list, ["a", "b"], options);
    reconcile(list, ["b", "c"], options);

    expect(created).toEqual(["a", "b", "c"]);
    expect(destroyed).toEqual(["a"]);
    expect([...list.children].map(node => node.textContent)).toEqual(["B", "C"]);
  });

  it("rejects duplicate keys rather than silently dropping an item", () => {
    const list = container();
    expect(() =>
      reconcile(list, ["a", "a"], {
        key: item => item,
        create: () => document.createElement("div"),
      }),
    ).toThrow(/duplicate reconcile key/);
  });

  it("empties the container when the model empties", () => {
    const list = container();
    const options = {
      key: (item: string) => item,
      create: () => document.createElement("div"),
    };
    reconcile(list, ["only"], options);
    expect(list.children).toHaveLength(1);
    reconcile(list, [], options);
    expect(list.children).toHaveLength(0);
  });
});

describe("renderShell", () => {
  it("parses markup once per root and caches lookups", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });

    const first = renderShell(root, `<p class="a">one</p>`);
    const paragraph = root.querySelector(".a");
    const second = renderShell(root, `<p class="a">one</p>`);

    expect(second).toBe(first);
    expect(root.querySelectorAll(".a")).toHaveLength(1);
    expect(first.find(".a")).toBe(paragraph);
    expect(first.find(".a")).toBe(paragraph);
  });
});

describe("Refs", () => {
  it("throws a legible error for a missing required node", () => {
    const host = document.createElement("div");
    host.innerHTML = `<span class="present"></span>`;
    const refs = new Refs(host);
    expect(refs.require(".present")).toBeInstanceOf(HTMLElement);
    expect(() => refs.require(".absent")).toThrow(/missing a required node/);
    expect(refs.find(".absent")).toBeNull();
  });
});

describe("debounce", () => {
  it("runs once with the latest arguments", async () => {
    const calls: number[] = [];
    const fn = debounce((value: number) => calls.push(value), 5);
    fn(1);
    fn(2);
    fn(3);
    expect(calls).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toEqual([3]);
  });

  it("supports flush and cancel", async () => {
    const calls: number[] = [];
    const fn = debounce((value: number) => calls.push(value), 50);
    fn(1);
    fn.flush();
    expect(calls).toEqual([1]);
    fn(2);
    fn.cancel();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(calls).toEqual([1]);
  });
});
