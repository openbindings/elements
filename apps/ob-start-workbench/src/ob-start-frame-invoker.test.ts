import { describe, expect, it } from "vitest";
import type { OBInterface } from "@openbindings/sdk";
import {
  OBStartFrameInvoker,
  adaptOBStartFrameBindings,
} from "./ob-start-frame-invoker.js";

describe("ob start frame carrier", () => {
  it("adapts both published invocation operations by selector", async () => {
    const original: OBInterface = {
      openbindings: "0.2.0",
      operations: {
        operation: {},
        binding: {},
        unrelated: {},
      },
      sources: {
        public: { bindingSpec: "openbindings.asyncapi@1", content: {} },
      },
      bindings: {
        operation: {
          operation: "operation",
          source: "public",
          selector: "#/operations/invokeOperation",
        },
        binding: {
          operation: "binding",
          source: "public",
          selector: "#/operations/invokeBinding",
        },
        unrelated: {
          operation: "unrelated",
          source: "public",
          selector: "#/operations/other",
        },
      },
    };

    const adapted = adaptOBStartFrameBindings(original);
    expect(adapted.bindings?.operation?.source).not.toBe("public");
    expect(adapted.bindings?.binding?.source).toBe(
      adapted.bindings?.operation?.source,
    );
    expect(adapted.bindings?.unrelated?.source).toBe("public");
    expect(original.bindings?.operation?.source).toBe("public");

    const invoker = new OBStartFrameInvoker({
      origin: "https://ob.example.test",
      token: () => "session",
    });
    await expect(invoker.prepareBinding({
      source: {
        bindingSpec: adapted.sources?.[adapted.bindings!.operation!.source]
          ?.bindingSpec ?? "",
      },
      selector: "#/operations/invokeBinding",
    })).resolves.toBeNull();
  });
});
