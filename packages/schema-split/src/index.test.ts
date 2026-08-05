import "@openbindings/json-editor/define";
import type { JSONEditorElement } from "@openbindings/json-editor";
import type { OBInterface } from "@openbindings/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_SPLIT_TAG, SchemaSplitElement } from "./index.js";

if (!customElements.get(SCHEMA_SPLIT_TAG)) {
  customElements.define(SCHEMA_SPLIT_TAG, SchemaSplitElement);
}

const obi: OBInterface = {
  openbindings: "0.2.0",
  name: "Example",
  operations: {
    echo: {
      input: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      output: { type: "object" },
    },
    describe: {
      output: { $ref: "#/schemas/Descriptor" },
    },
    tangled: {
      input: { $ref: "#/schemas/Node" },
    },
  },
  schemas: {
    Descriptor: {
      type: "object",
      properties: { name: { type: "string" } },
    },
    Node: {
      type: "object",
      properties: { next: { $ref: "#/schemas/Node" } },
    },
  },
};

function settled(): Promise<void> {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function mount(
  operationKey: string | null,
): Promise<SchemaSplitElement> {
  const element = document.createElement(
    SCHEMA_SPLIT_TAG,
  ) as SchemaSplitElement;
  element.obi = obi;
  element.operationKey = operationKey;
  document.body.append(element);
  await settled();
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("SchemaSplitElement", () => {
  it("renders both declared schemas as highlighted code blocks", async () => {
    const element = await mount("echo");
    const root = element.shadowRoot!;
    const input = root.querySelector<JSONEditorElement>(".input-schema")!;
    const output = root.querySelector<JSONEditorElement>(".output-schema")!;
    expect(input.hidden).toBe(false);
    // Read-only code views (rev 17.12.1): the panes are the same material
    // as the editors they sit above.
    expect(input.readOnly).toBe(true);
    expect(input.text).toContain('"message"');
    expect(output.hidden).toBe(false);
    expect(output.text).toContain('"type": "object"');
    expect(
      root.querySelector<HTMLButtonElement>(".copy-input")!.disabled,
    ).toBe(false);
  });

  it("dereferences local refs so the reader sees the contract, not a pointer", async () => {
    const element = await mount("describe");
    const root = element.shadowRoot!;
    const output = root.querySelector<JSONEditorElement>(".output-schema")!;
    expect(output.text).toContain('"name"');
    expect(output.text).not.toContain("$ref");
  });

  it("keeps a cyclic ref as an honest $ref marker instead of hanging", async () => {
    const element = await mount("tangled");
    const root = element.shadowRoot!;
    const input = root.querySelector<JSONEditorElement>(".input-schema")!;
    // The outer ref expands once; the inner self-reference stays a pointer.
    expect(input.text).toContain('"next"');
    expect(input.text).toContain('"$ref": "#/schemas/Node"');
  });

  it("keeps the rail verb visible but disabled for an absent schema", async () => {
    const element = await mount("describe");
    const root = element.shadowRoot!;
    // Steady rails: the copy button never vanishes, it greys out.
    const copyInput = root.querySelector<HTMLButtonElement>(".copy-input")!;
    expect(copyInput.hidden).toBe(false);
    expect(copyInput.disabled).toBe(true);
    expect(
      root.querySelector<HTMLElement>(".input-empty")!.hidden,
    ).toBe(false);
    expect(
      root.querySelector<HTMLElement>(".input-schema")!.hidden,
    ).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>(".copy-output")!.disabled,
    ).toBe(false);
  });

  it("shows the empty state without an operation", async () => {
    const element = await mount(null);
    const root = element.shadowRoot!;
    expect(root.querySelector<HTMLElement>(".empty")!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".workspace")!.hidden).toBe(true);
  });

  it("clamps splitRatio, applies it as grid variables, and never echoes assignment", async () => {
    const element = await mount("echo");
    const changed = vi.fn();
    element.addEventListener("ob-layout-change", changed);
    element.splitRatio = 0.95;
    await settled();
    expect(element.splitRatio).toBe(0.8);
    const workspace =
      element.shadowRoot!.querySelector<HTMLElement>(".workspace")!;
    expect(workspace.style.getPropertyValue("--_ob-split-input")).toBe(
      "0.8fr",
    );
    expect(workspace.style.getPropertyValue("--_ob-split-output")).toBe(
      "0.2fr",
    );
    expect(changed).not.toHaveBeenCalled();
  });

  it("emits ob-layout-change per effective keyboard step on the gutter", async () => {
    const element = await mount("echo");
    const gutter =
      element.shadowRoot!.querySelector<HTMLElement>(".layout-gutter")!;
    const ratios: number[] = [];
    element.addEventListener("ob-layout-change", event => {
      ratios.push(
        (event as CustomEvent<{ splitRatio: number }>).detail.splitRatio,
      );
    });
    gutter.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    gutter.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await settled();
    expect(ratios).toEqual([0.52, 0.54]);
    expect(element.splitRatio).toBe(0.54);
    expect(gutter.getAttribute("aria-valuenow")).toBe("54");
  });

  it("copies a schema and acknowledges with the check glyph", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
    const element = await mount("echo");
    const copy =
      element.shadowRoot!.querySelector<HTMLButtonElement>(".copy-input")!;
    // Fake timers wrap the copy so the ~1.6s acknowledgement revert is
    // observable; renders flush on microtasks, so no rAF waits in here.
    vi.useFakeTimers();
    try {
      copy.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(JSON.parse(writes[0]!)).toEqual(obi.operations.echo!.input);
      expect(copy.classList.contains("copied")).toBe(true);
      expect(copy.getAttribute("aria-label")).toBe("Copied");
      vi.advanceTimersByTime(1700);
      await Promise.resolve();
      await Promise.resolve();
      expect(copy.classList.contains("copied")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
