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
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";
import { operationInvokerInterface } from "./requirement.js";
import {
  OPERATION_WORKBENCH_TAG,
  OperationWorkbenchElement,
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
      await invocation.emitOutput({
        kind: "error",
        error: {
          code: "ERR_VALIDATION_FAILED",
          category: "validation",
          message: "output validation failed at /name",
        },
      });
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
    expect(element.shadowRoot?.querySelector("pre")?.textContent).toContain(
      '"message": "hello"',
    );
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
    });
    expect(element.shadowRoot?.querySelector("pre")?.textContent).toContain(
      "Showing the last 2 of 3 values.",
    );
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

  it("summarizes contract failures while retaining exact technical evidence", async () => {
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
    ).toContain("ERR_VALIDATION_FAILED:");
  });
});

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
