import {
  InvocationImpl,
  OperationInvoker,
  type BindingInvocationArgs,
  type BindingInvoker,
  type BindingSpecInfo,
  type OBInterface,
} from "@openbindings/sdk";
import { OperationEnvironment } from "@openbindings/ui-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  OperationFrameError,
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";
import { operationInvokerInterface } from "./requirement.js";
import {
  OPERATION_WORKBENCH_TAG,
  OperationWorkbenchElement,
  formatDuration,
  presentInvocationError,
} from "./index.js";

if (!customElements.get(OPERATION_WORKBENCH_TAG)) {
  customElements.define(OPERATION_WORKBENCH_TAG, OperationWorkbenchElement);
}

const LOCAL_BINDING_SPEC = "example.local-operation-invoker@1";

class LocalOperationInvokerBinding implements BindingInvoker {
  readonly receivedInputs: unknown[] = [];
  readonly receivedTargets: Array<{
    operation?: string;
    binding?: string;
  }> = [];

  constructor(
    private readonly mode: "complete" | "hang" | "many" | "error" = "complete",
    private readonly errorFrame: OperationFrameError = {
      code: "ERR_VALIDATION_FAILED",
    },
  ) {}

  bindingSpecs(): BindingSpecInfo[] {
    return [{ bindingSpec: LOCAL_BINDING_SPEC }];
  }

  invokeBinding<I = unknown, O = unknown>(
    _args: BindingInvocationArgs,
  ): InvocationImpl<I, O> {
    const invocation = new InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >();
    queueMicrotask(() => void this.drive(invocation));
    return invocation as unknown as InvocationImpl<I, O>;
  }

  private async drive(
    invocation: InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >,
  ): Promise<void> {
    let targetOperation = "";
    let targetBinding = "";
    let targetInput: unknown;
    for await (const frame of invocation.inputs()) {
      if (frame.kind === "open") {
        targetOperation = frame.input.operation ?? "";
        targetBinding = frame.input.binding ?? "";
        this.receivedTargets.push({
          ...(frame.input.operation
            ? { operation: frame.input.operation }
            : {}),
          ...(frame.input.binding ? { binding: frame.input.binding } : {}),
        });
      } else if (frame.kind === "input") {
        targetInput = frame.value;
        this.receivedInputs.push(frame.value);
      } else if (frame.kind === "close") {
        break;
      }
    }
    invocation.closeInput();
    if (this.mode === "hang") {
      await new Promise<void>(resolve => {
        if (invocation.signal.aborted) {
          resolve();
        } else {
          invocation.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        }
      });
      return;
    }
    if (this.mode === "error") {
      await invocation.emitOutput({ kind: "error", error: this.errorFrame });
      invocation.closeOutput();
      return;
    }
    const values =
      this.mode === "many"
        ? [1, 2, 3]
        : [{ targetOperation, targetBinding, targetInput }];
    for (const value of values) {
      await invocation.emitOutput({ kind: "output", value });
    }
    await invocation.emitOutput({ kind: "complete" });
    invocation.closeOutput();
  }
}

const targetOBI: OBInterface = {
  openbindings: "0.2.0",
  name: "Target",
  operations: {
    echo: {
      input: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      output: { type: "object" },
    },
  },
};

function operationInvokerCandidate(): OBInterface {
  return {
    ...structuredClone(operationInvokerInterface),
    sources: {
      local: {
        bindingSpec: LOCAL_BINDING_SPEC,
        content: {},
      },
    },
    bindings: {
      invoke: {
        operation: "openbindings.operation-invoker.invokeOperation",
        source: "local",
        ref: "invoke",
      },
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("OperationWorkbenchElement", () => {
  it("derives conservative starter input from the operation schema", async () => {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = {
      ...targetOBI,
      operations: {
        echo: {
          input: {
            type: "object",
            properties: {
              message: { type: "string" },
              limit: { type: "integer", default: 10 },
              optional: { type: "boolean" },
            },
            required: ["message"],
          },
        },
      },
    };
    element.operationKey = "echo";
    document.body.append(element);
    await settled();

    expect(JSON.parse(element.inputText)).toEqual({
      message: "",
      limit: 10,
    });
  });

  it("refuses to invent a starter for required constraints it cannot satisfy", async () => {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = {
      ...targetOBI,
      operations: {
        echo: {
          input: {
            type: "object",
            properties: {
              code: { type: "string", pattern: "^[A-Z]{3}-[0-9]+$" },
            },
            required: ["code"],
          },
        },
      },
    };
    element.operationKey = "echo";
    document.body.append(element);
    await settled();

    expect(element.inputText).toBe("");
    expect(element.resetInputToSchema()).toBe(false);
    expect(
      element.shadowRoot?.querySelector<HTMLButtonElement>(".reset-input")
        ?.disabled,
    ).toBe(true);
  });

  it("uses primitive allOf evidence without comparing it to an invented object", async () => {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = {
      ...targetOBI,
      operations: {
        echo: {
          input: {
            allOf: [{ type: "string", minLength: 3 }],
          },
        },
      },
    };
    element.operationKey = "echo";
    document.body.append(element);
    await settled();

    expect(JSON.parse(element.inputText)).toBe("xxx");
  });

  it("refuses contradictory string length constraints", async () => {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = {
      ...targetOBI,
      operations: {
        echo: {
          input: { type: "string", minLength: 4, maxLength: 3 },
        },
      },
    };
    element.operationKey = "echo";
    document.body.append(element);
    await settled();

    expect(element.inputText).toBe("");
    expect(element.resetInputToSchema()).toBe(false);
  });

  it("formats and resets input while emitting typed input change intent", async () => {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"hello"}';
    const changed = vi.fn();
    element.addEventListener("ob-input-change", changed);
    document.body.append(element);
    await settled();

    expect(element.formatInput()).toBe(true);
    expect(element.inputText).toBe('{\n  "message": "hello"\n}');
    expect(changed.mock.calls[0]?.[0].detail).toEqual({
      operationKey: "echo",
      text: '{\n  "message": "hello"\n}',
      mode: "single",
    });

    expect(element.resetInputToSchema()).toBe(true);
    expect(JSON.parse(element.inputText)).toEqual({ message: "" });
  });

  it("resolves the published Operation Invoker requirement and drives frames", async () => {
    const invoker = new OperationInvoker([
      new LocalOperationInvokerBinding(),
    ]);
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker,
        label: "local test",
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    const output = vi.fn();
    const complete = vi.fn();
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"hello"}';
    element.operationSource = environment;
    element.addEventListener("ob-output", output);
    element.addEventListener("ob-invocation-complete", complete);
    document.body.append(element);
    const statusAnnouncer = element.shadowRoot?.querySelector(
      ".status-announcer",
    );
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    await element.run();

    expect(output).toHaveBeenCalledTimes(1);
    expect((output.mock.calls[0]?.[0] as CustomEvent).detail.value).toEqual({
      targetOperation: "echo",
      targetBinding: "",
      targetInput: { message: "hello" },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(
      element.shadowRoot?.querySelector(".status-announcer"),
    ).toBe(statusAnnouncer);
    expect(statusAnnouncer?.textContent).toBe(
      "Invocation complete. 1 output value received.",
    );
    expect(outputEditorText(element)).toContain('"message": "hello"');
  });

  it("invokes an explicitly selected binding without also naming an operation", async () => {
    const binding = new LocalOperationInvokerBinding();
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([binding]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.bindingKey = "echo.http";
    element.inputText = '{"message":"routed"}';
    element.operationSource = environment;
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot
        ?.querySelector(".status")
        ?.textContent?.includes("echo.http"),
    );

    await element.run();

    expect(binding.receivedTargets).toEqual([{ binding: "echo.http" }]);
    expect(element.bindingKey).toBe("echo.http");
  });

  it("distinguishes ambiguity from unavailability", async () => {
    const candidate = operationInvokerCandidate();
    const invoker = new OperationInvoker([
      new LocalOperationInvokerBinding(),
    ]);
    const environment = new OperationEnvironment([
      { interface: candidate, invoker, label: "first" },
      { interface: candidate, invoker, label: "second" },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.operationSource = environment;
    document.body.append(element);

    await waitFor(() =>
      element.shadowRoot
        ?.querySelector(".status")
        ?.textContent?.includes("2 invocation implementations"),
    );
    expect(
      element.shadowRoot?.querySelector<HTMLButtonElement>(".run")?.disabled,
    ).toBe(true);

    environment.replace([]);
    await waitFor(() =>
      element.shadowRoot
        ?.querySelector(".status")
        ?.textContent?.includes("No compatible"),
    );
  });

  it("cancels an active invocation and suppresses its stale terminal", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([
          new LocalOperationInvokerBinding("hang"),
        ]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    const completed = vi.fn();
    const failed = vi.fn();
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"cancel me"}';
    element.operationSource = environment;
    element.addEventListener("ob-invocation-complete", completed);
    element.addEventListener("ob-invocation-error", failed);
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    const running = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );
    await element.cancel();
    await running;

    expect(completed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );
    // A cancelled run never settles: no stale output blocks, and the
    // placeholder returns.
    expect(
      element.shadowRoot?.querySelectorAll(".output-item").length,
    ).toBe(0);
    expect(
      element.shadowRoot?.querySelector(".output-notice")?.textContent,
    ).toBe("No output yet.");
  });

  it("bounds retained streaming output without dropping output events", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([
          new LocalOperationInvokerBinding("many"),
        ]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    const output = vi.fn();
    const complete = vi.fn();
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"stream"}';
    element.maxDisplayedOutputs = 2;
    element.operationSource = environment;
    element.addEventListener("ob-output", output);
    element.addEventListener("ob-invocation-complete", complete);
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    await element.run();

    expect(output).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].detail).toEqual({
      operationKey: "echo",
      outputs: [2, 3],
      outputCount: 3,
      truncated: true,
      durationMs: expect.any(Number),
    });
    expect(
      element.shadowRoot?.querySelector(".output-notice")?.textContent,
    ).toBe("Showing the last 2 of 3 values.");
    const items = element.shadowRoot?.querySelectorAll(".output-item") ?? [];
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toContain("#2");
    expect(items[1]?.textContent).toContain("#3");
  });

  it("keeps one array input distinct from an explicit input sequence", async () => {
    const binding = new LocalOperationInvokerBinding();
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([binding]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '[{"message":"one"},{"message":"two"}]';
    element.operationSource = environment;
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    await element.run();

    expect(binding.receivedInputs).toEqual([
      [{ message: "one" }, { message: "two" }],
    ]);

    element.inputMode = "sequence";
    expect(element.inputText).toBe('[{"message":"one"},{"message":"two"}]');
    binding.receivedInputs.length = 0;
    await element.run();

    expect(binding.receivedInputs).toEqual([
      { message: "one" },
      { message: "two" },
    ]);
  });

  it("summarizes contract failures while retaining the exact abstract record", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([
          new LocalOperationInvokerBinding("error"),
        ]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"valid input"}';
    element.operationSource = environment;
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    await element.run();
    await settled();

    expect(
      element.shadowRoot?.querySelector(".error-summary")?.textContent,
    ).toBe("A value did not match the operation contract.");
    expect(
      element.shadowRoot?.querySelector(".error-detail")?.textContent,
    ).toContain('"code": "ERR_VALIDATION_FAILED"');
  });

  it("renders an open extension code without inventing a classification", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([
          new LocalOperationInvokerBinding("error", {
            code: "ERR_AUTH_REJECTED",
          }),
        ]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    element.inputText = '{"message":"valid input"}';
    element.operationSource = environment;
    document.body.append(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    await element.run();
    await settled();

    expect(
      element.shadowRoot?.querySelector(".error-summary")?.textContent,
    ).toBe("The operation could not be completed.");
  });

  it("un-hides the workspace when the operation arrives after mount", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([new LocalOperationInvokerBinding()]),
      },
    ]);
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    document.body.append(element);
    await settled();
    const workspace =
      element.shadowRoot?.querySelector<HTMLElement>(".workspace");
    expect(workspace?.hidden).toBe(true);

    element.obi = targetOBI;
    element.operationKey = "echo";
    element.operationSource = environment;
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    expect(workspace?.hidden).toBe(false);
    expect(
      element.shadowRoot?.querySelector<HTMLElement>(".empty")?.hidden,
    ).toBe(true);
    const run = element.shadowRoot?.querySelector<HTMLButtonElement>(".run");
    expect(run).toBeTruthy();
    expect(run?.disabled).toBe(false);
  });
});

describe("presentInvocationError", () => {
  const codeCases: Array<{
    code: string;
    copy: string;
  }> = [
    {
      code: "ERR_VALIDATION_FAILED",
      copy: "A value did not match the operation contract.",
    },
    {
      code: "ERR_CANCELLED",
      copy: "The operation was cancelled.",
    },
    {
      code: "CONTEXT_REQUIRED",
      copy: "This operation needs credentials or other invocation context.",
    },
    {
      code: "ERR_TIMEOUT",
      copy: "The operation timed out.",
    },
    {
      code: "ERR_UNAVAILABLE",
      copy: "The target could not be reached.",
    },
  ];

  for (const { code, copy } of codeCases) {
    it(`uses non-normative presentation for understood code ${code}`, () => {
      const presented = presentInvocationError({ code });
      expect(presented.summary).toBe(copy);
    });
  }

  it("keeps understood code summaries distinguishable and non-empty", () => {
    const summaries = codeCases.map(
      entry =>
        presentInvocationError({
          code: entry.code,
        }).summary,
    );
    for (const summary of summaries) {
      expect(summary.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(summaries).size).toBe(summaries.length);
  });

  it("uses a generic introduction for an open extension code", () => {
    expect(
      presentInvocationError({
        code: "ERR_SERVICE_ERROR",
      }).summary,
    ).toBe("The operation could not be completed.");
  });

  it("never renders an empty summary for an error it cannot describe", () => {
    const undescribed = "The invoker reported an error it did not describe.";
    expect(
      presentInvocationError({} as OperationFrameError).summary,
    ).toBe(undescribed);
    expect(presentInvocationError(new Error("")).summary).toBe(undescribed);
    expect(
      presentInvocationError({
        code: "ERR_MYSTERY",
      }).summary,
    ).toBe("The operation could not be completed.");
  });

  it("attributes ERR_CONNECT_FAILED to the invoker transport, not the target", () => {
    const presented = presentInvocationError({
      code: "ERR_CONNECT_FAILED",
    });
    expect(presented.summary).toContain(
      "Could not reach the operation invoker.",
    );
    expect(presented.summary).toContain("session credential");
    expect(presented.summary.toLowerCase()).not.toContain("the target");
  });

  it("presents only abstract code and application-authored data", () => {
    const presented = presentInvocationError({
      code: "ERR_SERVICE_ERROR",
      data: { reason: "declined" },
    });
    expect(JSON.parse(presented.detail)).toEqual({
      code: "ERR_SERVICE_ERROR",
      data: { reason: "declined" },
    });
    expect(presented.detail).not.toContain("status");
    expect(presented.detail).not.toContain("headers");
  });

  it("preserves explicit-null data distinctly from absent data", () => {
    expect(JSON.parse(presentInvocationError({ code: "E", data: null }).detail))
      .toEqual({ code: "E", data: null });
    expect(JSON.parse(presentInvocationError({ code: "E" }).detail)).toEqual({
      code: "E",
    });
  });
});

describe("binding selector", () => {
  const multiBindingOBI: OBInterface = {
    openbindings: "0.2.0",
    name: "Target",
    operations: {
      echo: {
        aliases: ["echoAlias"],
        input: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
        output: { type: "object" },
      },
      other: {},
    },
    sources: {
      s: { bindingSpec: "example.http@1", content: {} },
    },
    bindings: {
      "echo.legacy": { operation: "echo", source: "s", deprecated: true },
      "echo.http": { operation: "echo", source: "s", preference: 10 },
      "echo.ws": { operation: "echo", source: "s", preference: 5 },
      "echo.alt": { operation: "echo", source: "s" },
      "echo.aliased": { operation: "echoAlias", source: "s" },
      "other.http": { operation: "other", source: "s", preference: 99 },
    },
  };

  function mountedSelector(obi: OBInterface = multiBindingOBI): {
    element: OperationWorkbenchElement;
    select: () => HTMLSelectElement | null;
    bar: () => HTMLElement | null;
  } {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = obi;
    element.operationKey = "echo";
    document.body.append(element);
    return {
      element,
      select: () =>
        element.shadowRoot?.querySelector<HTMLSelectElement>(
          ".binding-select",
        ) ?? null,
      bar: () =>
        element.shadowRoot?.querySelector<HTMLElement>(".binding-bar") ?? null,
    };
  }

  it("renders the selector only when the operation has two or more bindings", async () => {
    const multi = mountedSelector();
    await settled();
    expect(multi.select()).toBeTruthy();
    expect(multi.bar()?.hidden).toBe(false);

    const single = mountedSelector({
      ...multiBindingOBI,
      bindings: {
        "echo.http": { operation: "echo", source: "s", preference: 10 },
        "other.http": { operation: "other", source: "s" },
      },
    });
    await settled();
    expect(single.bar()?.hidden).toBe(true);

    const none = mountedSelector({ ...multiBindingOBI, bindings: {} });
    await settled();
    expect(none.bar()?.hidden).toBe(true);
  });

  it("orders options by descending preference, missing preference last then lexicographic, annotating deprecation", async () => {
    const { select } = mountedSelector();
    await settled();
    const options = Array.from(select()?.options ?? []).filter(
      option => option.value !== "",
    );
    expect(options.map(option => option.value)).toEqual([
      "echo.http",
      "echo.ws",
      "echo.aliased",
      "echo.alt",
      "echo.legacy",
    ]);
    expect(
      options.find(option => option.value === "echo.legacy")?.textContent,
    ).toBe("echo.legacy · deprecated");
    expect(
      options.find(option => option.value === "echo.http")?.textContent,
    ).toBe("echo.http");
  });

  it("shows a placeholder while bindingKey is null and drops it once a binding is chosen", async () => {
    const { element, select } = mountedSelector();
    await settled();
    const placeholder = Array.from(select()?.options ?? []).find(
      option => option.value === "",
    );
    expect(placeholder?.textContent).toBe("choose a binding…");
    expect(select()?.value).toBe("");

    element.bindingKey = "echo.ws";
    await settled();
    expect(select()?.value).toBe("echo.ws");
    expect(
      Array.from(select()?.options ?? []).some(option => option.value === ""),
    ).toBe(false);
  });

  it("reflects programmatic bindingKey assignment without emitting or announcing", async () => {
    const { element, select } = mountedSelector();
    const selected = vi.fn();
    element.addEventListener("ob-binding-select", selected);
    await settled();
    const announcer = element.shadowRoot?.querySelector(".status-announcer");
    const announced = announcer?.textContent;

    element.bindingKey = "echo.http";
    await settled();

    expect(select()?.value).toBe("echo.http");
    expect(selected).not.toHaveBeenCalled();
    expect(announcer?.textContent).toBe(announced);
  });

  it("falls back to the placeholder for a stale or unknown bindingKey", async () => {
    const { element, select } = mountedSelector();
    element.bindingKey = "echo.retired";
    await settled();
    expect(select()?.value).toBe("");
    expect(
      Array.from(select()?.options ?? []).find(option => option.value === "")
        ?.textContent,
    ).toBe("choose a binding…");
  });

  it("commits a user change to the property and emits exactly one ob-binding-select", async () => {
    const { element, select } = mountedSelector();
    const selected = vi.fn();
    element.addEventListener("ob-binding-select", selected);
    await settled();

    const node = select();
    expect(node).toBeTruthy();
    node!.value = "echo.ws";
    node!.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();

    expect(element.bindingKey).toBe("echo.ws");
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0]?.[0].detail).toEqual({
      bindingKey: "echo.ws",
      binding: { operation: "echo", source: "s", preference: 5 },
    });
  });

  it("names the selector for assistive technology and disables it while running", async () => {
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([
          new LocalOperationInvokerBinding("hang"),
        ]),
      },
    ]);
    const { element, select } = mountedSelector();
    element.bindingKey = "echo.http";
    element.inputText = '{"message":"hold"}';
    element.operationSource = environment;
    await waitFor(() =>
      element.shadowRoot
        ?.querySelector(".status")
        ?.textContent?.includes("echo.http"),
    );
    expect(select()?.getAttribute("aria-label")).toBe("Binding for echo");
    expect(select()?.disabled).toBe(false);
    // The visible pill reads "Ready · echo.http", but the live region speaks
    // only dependency and run state — reflection is not announced.
    expect(
      element.shadowRoot?.querySelector(".status-announcer")?.textContent,
    ).toBe("Ready");

    const running = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );
    expect(select()?.disabled).toBe(true);

    await element.cancel();
    await running;
    await settled();
    expect(select()?.disabled).toBe(false);
  });

  it("carries the binding chosen through the selector in the open frame", async () => {
    const binding = new LocalOperationInvokerBinding();
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([binding]),
      },
    ]);
    const { element, select } = mountedSelector();
    element.inputText = '{"message":"routed"}';
    element.operationSource = environment;
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    const node = select();
    node!.value = "echo.ws";
    node!.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    await element.run();

    expect(binding.receivedTargets).toEqual([{ binding: "echo.ws" }]);
  });
});

/**
 * A binding the test drives frame by frame: outputs are released only when
 * the test pushes them, so intermediate stream states are observable.
 */
class GatedStreamBinding implements BindingInvoker {
  #emit:
    | ((frame: OperationInvokerOutputFrame) => Promise<void>)
    | null = null;
  #finish: (() => void) | null = null;

  bindingSpecs(): BindingSpecInfo[] {
    return [{ bindingSpec: LOCAL_BINDING_SPEC }];
  }

  async push(value: unknown): Promise<void> {
    try {
      await this.#emit?.({ kind: "output", value });
    } catch {
      // Pushing into a cancelled invocation is part of what the stale-frame
      // tests exercise; the rejection itself is irrelevant to them.
    }
  }

  async finish(): Promise<void> {
    try {
      await this.#emit?.({ kind: "complete" });
    } catch {
      // See push().
    }
    this.#finish?.();
  }

  invokeBinding<I = unknown, O = unknown>(
    _args: BindingInvocationArgs,
  ): InvocationImpl<I, O> {
    const invocation = new InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >();
    queueMicrotask(() => void this.drive(invocation));
    return invocation as unknown as InvocationImpl<I, O>;
  }

  private async drive(
    invocation: InvocationImpl<
      OperationInvokerInputFrame,
      OperationInvokerOutputFrame
    >,
  ): Promise<void> {
    for await (const frame of invocation.inputs()) {
      if (frame.kind === "close") break;
    }
    invocation.closeInput();
    this.#emit = frame => invocation.emitOutput(frame);
    await new Promise<void>(resolve => {
      this.#finish = resolve;
      if (invocation.signal.aborted) resolve();
      else
        invocation.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
    });
    if (!invocation.signal.aborted) invocation.closeOutput();
  }
}

async function mountGated(binding: GatedStreamBinding): Promise<{
  element: OperationWorkbenchElement;
  items: () => NodeListOf<Element>;
  notice: () => HTMLElement | null;
  completions: Array<{ outputCount: number; durationMs: number }>;
}> {
  const environment = new OperationEnvironment([
    {
      interface: operationInvokerCandidate(),
      invoker: new OperationInvoker([binding]),
    },
  ]);
  const element = document.createElement(
    OPERATION_WORKBENCH_TAG,
  ) as OperationWorkbenchElement;
  element.obi = targetOBI;
  element.operationKey = "echo";
  element.inputText = '{"message":"stream"}';
  element.operationSource = environment;
  document.body.append(element);
  await waitFor(() =>
    element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
  );
  const root = element.shadowRoot!;
  // Count and duration left the element's chrome in rev 17.6 — the host
  // strip reports them from this event; tests assert the same contract.
  const completions: Array<{ outputCount: number; durationMs: number }> = [];
  element.addEventListener("ob-invocation-complete", event => {
    const detail = (
      event as CustomEvent<{ outputCount: number; durationMs: number }>
    ).detail;
    completions.push({
      outputCount: detail.outputCount,
      durationMs: detail.durationMs,
    });
  });
  return {
    element,
    items: () => root.querySelectorAll(".output-item"),
    notice: () => root.querySelector<HTMLElement>(".output-notice"),
    completions,
  };
}

describe("output view v2", () => {
  it("renders one array-valued output as a single bare block, distinct from a streamed pair", async () => {
    const single = new GatedStreamBinding();
    const a = await mountGated(single);
    const runA = a.element.run();
    await waitFor(() =>
      a.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await single.push([1, 2]);
    await waitFor(() => a.items().length === 1);
    await single.finish();
    await runA;
    await settled();

    expect(a.items().length).toBe(1);
    expect(a.completions[0]?.outputCount).toBe(1);
    // A single value renders directly in the shared editor: no selector
    // chrome (rev 17.4).
    expect(
      a.element.shadowRoot?.querySelector<HTMLElement>(".output-list")?.hidden,
    ).toBe(true);
    expect(outputEditorText(a.element).trimStart()).toMatch(/^\[/);

    const pair = new GatedStreamBinding();
    const b = await mountGated(pair);
    const runB = b.element.run();
    await waitFor(() =>
      b.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await pair.push(1);
    await pair.push(2);
    await waitFor(() => b.items().length === 2);
    await pair.finish();
    await runB;
    await settled();

    expect(b.items().length).toBe(2);
    expect(b.completions[0]?.outputCount).toBe(2);
    expect(
      b.element.shadowRoot?.querySelector<HTMLElement>(".output-list")?.hidden,
    ).toBe(false);
    expect(b.items()[0]?.textContent).toContain("#1");
    expect(b.items()[1]?.textContent).toContain("#2");
    // Default selection follows the latest frame.
    expect(b.items()[1]?.classList.contains("selected")).toBe(true);
  });

  it("appends per frame with stable node identity (O(new frame) rendering)", async () => {
    const binding = new GatedStreamBinding();
    const { element, items } = await mountGated(binding);
    element.maxDisplayedOutputs = 2;
    const run = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );

    await binding.push({ frame: 1 });
    await waitFor(() => items().length === 1);
    const first = items()[0]!;
    const firstText = first.textContent;

    await binding.push({ frame: 2 });
    await waitFor(() => items().length === 2);
    // The first row is the same node with the same preview text — no
    // rebuild, no re-stringify of already-displayed values.
    expect(items()[0]).toBe(first);
    expect(first.textContent).toBe(firstText);
    const second = items()[1]!;

    await binding.push({ frame: 3 });
    await waitFor(() =>
      items().length === 2 &&
      items()[1]?.textContent?.includes("#3") === true,
    );
    // Retention evicted frame 1; frame 2's node survived by identity.
    expect(items()[0]).toBe(second);

    await binding.finish();
    await run;
  });

  it("records stream offsets from the first frame and settles a total duration", async () => {
    let fakeNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);

    const single = new GatedStreamBinding();
    const a = await mountGated(single);
    const runA = a.element.run();
    await waitFor(() =>
      a.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await single.push({ ok: true });
    await waitFor(() => a.items().length === 1);
    fakeNow = 1213;
    await single.finish();
    await runA;
    await settled();

    // The duration reaches hosts through the completion event; the strip
    // renders it with the same formatter.
    expect(a.completions[0]?.durationMs).toBe(213);
    expect(formatDuration(a.completions[0]!.durationMs)).toBe("213ms");
    expect(a.completions[0]?.outputCount).toBe(1);

    fakeNow = 0;
    const stream = new GatedStreamBinding();
    const b = await mountGated(stream);
    const runB = b.element.run();
    await waitFor(() =>
      b.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await stream.push(1);
    await waitFor(() => b.items().length === 1);
    fakeNow = 1200;
    await stream.push(2);
    await waitFor(() => b.items().length === 2);
    fakeNow = 1400;
    await stream.finish();
    await runB;
    await settled();

    const rows = Array.from(b.items()).map(item => item.textContent ?? "");
    expect(rows[0]).toContain("+0ms");
    expect(rows[1]).toContain("+1.2s");
    expect(formatDuration(b.completions[0]!.durationMs)).toBe("1.4s");
  });

  it("reads as live progress while streaming and settles on terminal", async () => {
    const binding = new GatedStreamBinding();
    const { element, items, completions } = await mountGated(binding);
    const announcer = element.shadowRoot?.querySelector(".status-announcer");
    const run = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );

    await binding.push(1);
    await binding.push(2);
    await waitFor(() => items().length === 2);
    // Mid-stream: progress speaks through the live region (the visible
    // count/duration chrome moved to the host strip in rev 17.6), and the
    // completion event has not fired yet.
    await waitFor(
      () =>
        announcer?.textContent === "Invocation running. 2 values so far.",
    );
    expect(completions.length).toBe(0);

    await binding.finish();
    await run;
    await settled();
    expect(completions[0]?.outputCount).toBe(2);
    expect(announcer?.textContent).toBe(
      "Invocation complete. 2 output values received.",
    );
  });

  it("preserves an explicit selection across subsequent appends", async () => {
    const binding = new GatedStreamBinding();
    const { element, items } = await mountGated(binding);
    const run = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );

    await binding.push(1);
    await binding.push(2);
    await waitFor(() => items().length === 2);
    // Default follows the latest…
    expect(items()[1]?.classList.contains("selected")).toBe(true);
    // …until the user picks a value; the pick then survives appends instead
    // of yanking the editor to each new frame.
    (items()[0] as HTMLButtonElement).click();
    await settled();
    expect(items()[0]?.classList.contains("selected")).toBe(true);
    expect(outputEditorText(element)).toBe("1");

    await binding.push(3);
    await waitFor(() => items().length === 3);
    expect(items()[0]?.classList.contains("selected")).toBe(true);
    expect(outputEditorText(element)).toBe("1");

    await binding.finish();
    await run;
  });

  it("copies a bare value for one output and a JSON array for many, never timing labels", async () => {
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

    const single = new GatedStreamBinding();
    const a = await mountGated(single);
    const copyButton = a.element.shadowRoot?.querySelector<HTMLButtonElement>(
      ".copy-output",
    );
    expect(copyButton).toBeTruthy();
    expect(copyButton?.disabled).toBe(true);
    const runA = a.element.run();
    await waitFor(() =>
      a.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await single.push({ answer: 42 });
    await single.finish();
    await runA;
    await settled();

    expect(copyButton?.disabled).toBe(false);
    // Fake timers wrap the copy so the ~1.6s "Copied" revert is observable.
    vi.useFakeTimers();
    try {
      expect(await a.element.copyOutput()).toBe(true);
      expect(JSON.parse(writes[0]!)).toEqual({ answer: 42 });
      await Promise.resolve();
      await Promise.resolve();
      expect(copyButton?.classList.contains("copied")).toBe(true);
      expect(copyButton?.getAttribute("aria-label")).toBe("Copied");
      vi.advanceTimersByTime(1700);
      await Promise.resolve();
      await Promise.resolve();
      expect(copyButton?.classList.contains("copied")).toBe(false);
      expect(copyButton?.getAttribute("aria-label")).toBe(
        "Copy output as JSON",
      );
    } finally {
      vi.useRealTimers();
    }

    const stream = new GatedStreamBinding();
    const b = await mountGated(stream);
    const runB = b.element.run();
    await waitFor(() =>
      b.element.shadowRoot?.querySelector(".status")?.textContent ===
        "Running",
    );
    await stream.push({ n: 1 });
    await stream.push({ n: 2 });
    await stream.finish();
    await runB;
    await settled();

    expect(await b.element.copyOutput()).toBe(true);
    expect(JSON.parse(writes[1]!)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("never renders frames or timings from a cancelled run", async () => {
    const binding = new GatedStreamBinding();
    const { element, items, notice, completions } = await mountGated(binding);
    const run = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );
    await binding.push(1);
    await waitFor(() => items().length === 1);

    await element.cancel();
    await binding.push(2);
    await binding.finish();
    await run;
    await settled();

    // The stale run's later frames never render, and no completion (hence no
    // duration) ever settles for a cancelled run.
    expect(items().length).toBe(1);
    expect(completions.length).toBe(0);

    element.clearOutput();
    await settled();
    expect(items().length).toBe(0);
    expect(completions.length).toBe(0);
    expect(notice()?.textContent).toBe("No output yet.");
  });
});

describe("formatDuration", () => {
  it("scales durations devtools-style", async () => {
    const mod = (await import("./index.js")) as unknown as {
      formatDuration?: (ms: number) => string;
    };
    const formatDuration = mod.formatDuration;
    expect(typeof formatDuration).toBe("function");
    expect(formatDuration!(0)).toBe("0ms");
    expect(formatDuration!(213)).toBe("213ms");
    expect(formatDuration!(999.4)).toBe("999ms");
    // The branch is chosen after rounding, so 999.6ms is 1s, never "1000ms".
    expect(formatDuration!(999.6)).toBe("1s");
    expect(formatDuration!(1234)).toBe("1.2s");
    // Trailing .0 is trimmed.
    expect(formatDuration!(2000)).toBe("2s");
    expect(formatDuration!(59949)).toBe("59.9s");
    // 59.96s rounds past the minute boundary and must not read "60s".
    expect(formatDuration!(59960)).toBe("1m 0s");
    expect(formatDuration!(83000)).toBe("1m 23s");
    expect(formatDuration!(-5)).toBe("0ms");
    expect(formatDuration!(Number.NaN)).toBe("0ms");
  });
});

describe("form input view", () => {
  const formOBI: OBInterface = {
    openbindings: "0.2.0",
    name: "Target",
    operations: {
      order: {
        input: { $ref: "#/schemas/OrderInput" },
        output: { type: "object" },
      },
    },
    schemas: {
      OrderInput: {
        type: "object",
        properties: {
          message: { type: "string", description: "What to send" },
          size: { type: "string", enum: ["v1", "v2"] },
          active: { type: "boolean" },
          count: { type: "integer", default: 2 },
        },
        required: ["message"],
      },
    },
  };

  function mountForm(obi: OBInterface = formOBI): {
    element: OperationWorkbenchElement;
    root: ShadowRoot;
    formButton: () => HTMLButtonElement | null;
    formView: () => HTMLElement | null;
    banner: () => HTMLElement | null;
  } {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = obi;
    element.operationKey = Object.keys(obi.operations)[0] ?? null;
    document.body.append(element);
    const root = element.shadowRoot!;
    return {
      element,
      root,
      formButton: () => root.querySelector<HTMLButtonElement>(".view-form"),
      formView: () => root.querySelector<HTMLElement>(".form-view"),
      banner: () => root.querySelector<HTMLElement>(".form-status"),
    };
  }

  it("renders a Source/Form toggle that enters form mode with labeled, wired fields", async () => {
    const { element, root, formButton, formView } = mountForm();
    await settled();
    // $ref-rooted schema: the local reference resolves before capability
    // analysis, so the form toggle is available.
    expect(formButton()?.disabled).toBe(false);
    expect(element.inputView).toBe("json");

    formButton()!.click();
    await settled();
    expect(element.inputView).toBe("form");
    expect(formView()?.hidden).toBe(false);
    expect(
      root.querySelector<HTMLElement>(".input-editor")?.hidden,
    ).toBe(true);
    expect(formButton()?.getAttribute("aria-pressed")).toBe("true");

    const messageInput = root.querySelector<HTMLInputElement>("#f-message");
    expect(messageInput).toBeTruthy();
    const messageLabel = root.querySelector<HTMLLabelElement>(
      'label[for="f-message"]',
    );
    expect(messageLabel?.textContent).toContain("message");
    expect(messageLabel?.textContent).toContain("*");
    expect(
      root.querySelector<HTMLSelectElement>("select#f-size"),
    ).toBeTruthy();
    expect(
      Array.from(
        root.querySelectorAll<HTMLOptionElement>("select#f-size option"),
      ).map(option => option.value),
    ).toContain("v2");
    expect(
      root.querySelector<HTMLInputElement>("#f-active")?.type,
    ).toBe("checkbox");
    expect(root.querySelector<HTMLInputElement>("#f-count")?.type).toBe(
      "number",
    );
    // Descriptions render muted next to their field.
    expect(root.textContent).toContain("What to send");

    // Switching back rewrites nothing: text is the single source of truth.
    const before = element.inputText;
    root.querySelector<HTMLButtonElement>(".view-json")!.click();
    await settled();
    expect(element.inputText).toBe(before);
    expect(formView()?.hidden).toBe(true);
  });

  it("disables the toggle with the capability reason for unsupported schemas and sequence mode", async () => {
    const combinator = mountForm({
      ...formOBI,
      operations: {
        order: {
          input: { allOf: [{ type: "object" }] },
        },
      },
    });
    await settled();
    // The decline-with-reason lives on the disabled toggle itself (rev 17.6
    // moved the old hint row's copy into the button's tooltip).
    expect(combinator.formButton()?.disabled).toBe(true);
    expect(combinator.formButton()?.title).toContain('"allOf"');

    const sequence = mountForm();
    sequence.element.inputMode = "sequence";
    await settled();
    expect(sequence.formButton()?.disabled).toBe(true);
    expect(sequence.formButton()?.title).toContain("one JSON value");
  });

  it("patches inputText through the shared pipeline so run carries form edits", async () => {
    const binding = new LocalOperationInvokerBinding();
    const environment = new OperationEnvironment([
      {
        interface: operationInvokerCandidate(),
        invoker: new OperationInvoker([binding]),
      },
    ]);
    const { element, root, formButton } = mountForm();
    element.operationSource = environment;
    const changed = vi.fn();
    element.addEventListener("ob-input-change", changed);
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Ready",
    );

    formButton()!.click();
    await settled();
    const messageInput = root.querySelector<HTMLInputElement>("#f-message")!;
    messageInput.value = "hello from form";
    messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settled();

    expect(changed).toHaveBeenCalled();
    expect(JSON.parse(element.inputText)).toMatchObject({
      message: "hello from form",
    });

    await element.run();
    expect(binding.receivedInputs.length).toBe(1);
    expect(binding.receivedInputs[0]).toMatchObject({
      message: "hello from form",
    });
  });

  it("shows the no-match banner with JSON and reset affordances, never silently", async () => {
    const { element, root, formButton, banner } = mountForm();
    element.inputText = "[1, 2]";
    await settled();
    formButton()!.click();
    await settled();

    // A non-object top level is a parse-shape banner…
    expect(banner()?.hidden).toBe(false);
    expect(banner()?.textContent).toContain(
      "must be an object at the top level",
    );

    // …while conforming JSON that misses the schema is the no-match banner.
    element.inputText = '{"message": 42}';
    await settled();
    expect(banner()?.hidden).toBe(false);
    expect(banner()?.textContent).toContain("doesn't match");
    const resetButton =
      root.querySelector<HTMLButtonElement>(".form-banner-reset");
    expect(
      root.querySelector<HTMLButtonElement>(".form-banner-json"),
    ).toBeTruthy();
    expect(resetButton).toBeTruthy();

    resetButton!.click();
    await settled();
    expect(banner()?.hidden).toBe(true);
    expect(root.querySelector("#f-message")).toBeTruthy();
    expect(JSON.parse(element.inputText)).toMatchObject({ message: "" });
  });

  it("renders the oneOf picker, regenerating the branch starter and capability", async () => {
    const { element, root } = mountForm({
      ...formOBI,
      operations: {
        order: {
          input: {
            oneOf: [
              {
                title: "ById",
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
              {
                title: "ByName",
                type: "object",
                properties: { name: { type: "string", default: "n" } },
                required: ["name"],
              },
              {
                title: "Opaque",
                allOf: [{ type: "object" }],
              },
            ],
          },
        },
      },
    });
    await settled();
    const shape = root.querySelector<HTMLSelectElement>(".input-shape");
    expect(shape).toBeTruthy();
    expect(
      Array.from(shape!.options).map(option => option.textContent),
    ).toEqual(["ById", "ByName", "Opaque"]);
    expect(JSON.parse(element.inputText)).toEqual({ id: "" });

    shape!.value = "1";
    shape!.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    expect(JSON.parse(element.inputText)).toEqual({ name: "n" });
    expect(
      root.querySelector<HTMLButtonElement>(".view-form")?.disabled,
    ).toBe(false);

    shape!.value = "2";
    shape!.dispatchEvent(new Event("change", { bubbles: true }));
    await settled();
    // Per-branch capability: the combinator branch declines with reason.
    expect(
      root.querySelector<HTMLButtonElement>(".view-form")?.disabled,
    ).toBe(true);
    expect(
      root.querySelector<HTMLButtonElement>(".view-form")?.title,
    ).toContain('"allOf"');
  });

  it("supports array fields with add and remove flowing through the text pipeline", async () => {
    const { element, root, formButton } = mountForm({
      ...formOBI,
      operations: {
        order: {
          input: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });
    await settled();
    formButton()!.click();
    await settled();

    const add = root.querySelector<HTMLButtonElement>('[part~="form-add"]');
    expect(add).toBeTruthy();
    add!.click();
    await settled();
    expect(JSON.parse(element.inputText)).toEqual({ tags: [""] });

    const remove = root.querySelector<HTMLButtonElement>(
      '[part~="form-remove"]',
    );
    expect(remove).toBeTruthy();
    remove!.click();
    await settled();
    expect(JSON.parse(element.inputText)).toEqual({ tags: [] });
  });
});

describe("split layout", () => {
  function mountLayout(): {
    element: OperationWorkbenchElement;
    workspace: () => HTMLElement | null;
    gutter: () => HTMLElement | null;
  } {
    const element = document.createElement(
      OPERATION_WORKBENCH_TAG,
    ) as OperationWorkbenchElement;
    element.obi = targetOBI;
    element.operationKey = "echo";
    document.body.append(element);
    const root = element.shadowRoot!;
    return {
      element,
      workspace: () => root.querySelector<HTMLElement>(".workspace"),
      gutter: () => root.querySelector<HTMLElement>(".layout-gutter"),
    };
  }

  it("defaults to stacked and toggles split without rebuilding the editor or output blocks", async () => {
    const binding = new GatedStreamBinding();
    const { element, items } = await mountGated(binding);
    const run = element.run();
    await waitFor(() =>
      element.shadowRoot?.querySelector(".status")?.textContent === "Running",
    );
    await binding.push(1);
    await binding.push(2);
    await waitFor(() => items().length === 2);
    await binding.finish();
    await run;
    await settled();

    expect(element.layout).toBe("stacked");
    const root = element.shadowRoot!;
    const workspace = root.querySelector<HTMLElement>(".workspace")!;
    const gutter = root.querySelector<HTMLElement>(".layout-gutter")!;
    expect(workspace.classList.contains("split")).toBe(false);
    expect(gutter.hidden).toBe(true);

    const editor = root.querySelector(".input-editor")!;
    const firstItem = items()[0]!;
    const firstPre = firstItem.querySelector("pre")!;

    element.layout = "split";
    await settled();
    expect(workspace.classList.contains("split")).toBe(true);
    // The container joins the fill chain in split mode (height propagation).
    expect(root.querySelector(".container")?.classList.contains("split")).toBe(
      true,
    );
    expect(gutter.hidden).toBe(false);
    // Geometry only: the editor and output nodes survive by identity.
    expect(root.querySelector(".input-editor")).toBe(editor);
    expect(items()[0]).toBe(firstItem);
    expect(items()[0]?.querySelector("pre")).toBe(firstPre);

    element.layout = "stacked";
    await settled();
    expect(workspace.classList.contains("split")).toBe(false);
    expect(root.querySelector(".container")?.classList.contains("split")).toBe(
      false,
    );
    expect(gutter.hidden).toBe(true);
    expect(root.querySelector(".input-editor")).toBe(editor);
    expect(items()[0]).toBe(firstItem);

    // The layout attribute is a parse-time convenience for the same property.
    element.setAttribute("layout", "split");
    expect(element.layout).toBe("split");
    expect(() => {
      (element as unknown as { layout: string }).layout = "diagonal";
    }).toThrow(TypeError);
  });

  it("clamps splitRatio, reflects it in the grid template and separator aria, and never echoes assignment", async () => {
    const { element, workspace, gutter } = mountLayout();
    const changed = vi.fn();
    element.addEventListener("ob-layout-change", changed);
    element.layout = "split";
    await settled();

    expect(element.splitRatio).toBe(0.5);
    const node = gutter()!;
    expect(node.getAttribute("role")).toBe("separator");
    expect(node.getAttribute("aria-orientation")).toBe("vertical");
    expect(node.getAttribute("aria-label")).toBe("Resize input and output");
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(node.getAttribute("aria-valuemin")).toBe("20");
    expect(node.getAttribute("aria-valuemax")).toBe("80");
    expect(node.getAttribute("aria-valuenow")).toBe("50");

    element.splitRatio = 0.65;
    await settled();
    expect(workspace()?.style.getPropertyValue("--_ob-split-input")).toBe(
      "0.65fr",
    );
    expect(workspace()?.style.getPropertyValue("--_ob-split-output")).toBe(
      "0.35fr",
    );
    expect(node.getAttribute("aria-valuenow")).toBe("65");

    element.splitRatio = 0.95;
    expect(element.splitRatio).toBe(0.8);
    element.splitRatio = 0.01;
    expect(element.splitRatio).toBe(0.2);
    expect(() => {
      element.splitRatio = Number.NaN;
    }).toThrow(TypeError);
    // Programmatic assignment never echoes.
    expect(changed).not.toHaveBeenCalled();
  });

  it("resizes with keyboard steps and bounds, emitting ob-layout-change per effective step", async () => {
    const { element, gutter } = mountLayout();
    element.layout = "split";
    await settled();
    const changed = vi.fn();
    element.addEventListener("ob-layout-change", changed);
    const node = gutter()!;
    const press = (key: string) =>
      node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    press("ArrowRight");
    expect(element.splitRatio).toBe(0.52);
    press("ArrowLeft");
    expect(element.splitRatio).toBe(0.5);
    press("Home");
    expect(element.splitRatio).toBe(0.2);
    press("End");
    expect(element.splitRatio).toBe(0.8);
    // A step that cannot move (already at the bound) does not emit.
    press("End");
    expect(element.splitRatio).toBe(0.8);

    expect(changed).toHaveBeenCalledTimes(4);
    expect(
      changed.mock.calls.map(
        call => (call[0] as CustomEvent<{ splitRatio: number }>).detail,
      ),
    ).toEqual([
      { splitRatio: 0.52 },
      { splitRatio: 0.5 },
      { splitRatio: 0.2 },
      { splitRatio: 0.8 },
    ]);
  });

  it("drags with pointer capture and emits a single ob-layout-change at drag end", async () => {
    const { element, workspace, gutter } = mountLayout();
    element.layout = "split";
    await settled();
    const changed = vi.fn();
    element.addEventListener("ob-layout-change", changed);
    const node = gutter()!;
    const body = workspace()!;
    body.getBoundingClientRect = () =>
      ({ left: 0, width: 600, top: 0, height: 400 }) as DOMRect;
    const capture = vi.fn();
    const release = vi.fn();
    (node as unknown as Record<string, unknown>).setPointerCapture = capture;
    (node as unknown as Record<string, unknown>).releasePointerCapture =
      release;

    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 7 });
      node.dispatchEvent(event);
    };

    pointer("pointerdown", 300);
    expect(capture).toHaveBeenCalledWith(7);
    pointer("pointermove", 180);
    expect(element.splitRatio).toBe(0.3);
    // No event while the drag is still in progress.
    expect(changed).not.toHaveBeenCalled();
    pointer("pointerup", 180);
    expect(release).toHaveBeenCalledWith(7);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(
      (changed.mock.calls[0]?.[0] as CustomEvent<{ splitRatio: number }>)
        .detail,
    ).toEqual({ splitRatio: 0.3 });

    // A drag that never moves ends silently.
    pointer("pointerdown", 200);
    pointer("pointerup", 200);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("falls back to stacked below 36rem and restores split when wide, preserving the property", async () => {
    const observed: Array<{
      callback: (entries: Array<{ contentRect: { width: number } }>) => void;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class StubResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      #callback: (
        entries: Array<{ contentRect: { width: number } }>,
      ) => void;
      constructor(
        callback: (entries: Array<{ contentRect: { width: number } }>) => void,
      ) {
        this.#callback = callback;
        observed.push({
          callback: entries => this.#callback(entries),
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    try {
      const { element, workspace, gutter } = mountLayout();
      element.layout = "split";
      await settled();
      expect(observed.length).toBe(1);
      expect(observed[0]!.observe).toHaveBeenCalledWith(workspace());
      expect(workspace()?.classList.contains("split")).toBe(true);

      observed[0]!.callback([{ contentRect: { width: 500 } }]);
      await settled();
      expect(workspace()?.classList.contains("split")).toBe(false);
      expect(workspace()?.classList.contains("narrow")).toBe(true);
      expect(gutter()?.hidden).toBe(true);
      // Presentation falls back; the property is preserved.
      expect(element.layout).toBe("split");

      observed[0]!.callback([{ contentRect: { width: 900 } }]);
      await settled();
      expect(workspace()?.classList.contains("split")).toBe(true);
      expect(workspace()?.classList.contains("narrow")).toBe(false);
      expect(gutter()?.hidden).toBe(false);

      element.remove();
      expect(observed[0]!.disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function outputEditorText(element: HTMLElement): string {
  const editor = element.shadowRoot?.querySelector(".output-editor") as
    | (HTMLElement & { text: string })
    | null;
  return editor?.text ?? "";
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean | undefined): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("condition was not reached");
}
