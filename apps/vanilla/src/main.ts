import "@openbindings/obi-explorer/define";
import type { OBIExplorerElement } from "@openbindings/obi-explorer";
import "@openbindings/operation-detail/define";
import type { OperationDetailElement } from "@openbindings/operation-detail";
import {
  operationInvokerInterface,
  type OperationInvokerInputFrame,
  type OperationInvokerOutputFrame,
} from "@openbindings/operation-workbench";
import "@openbindings/operation-workbench/define";
import type { OperationWorkbenchElement } from "@openbindings/operation-workbench";
import {
  InvocationImpl,
  OperationInvoker,
  type BindingInvocationArgs,
  type BindingInvoker,
  type BindingSpecInfo,
  type OBInterface,
} from "@openbindings/sdk";
import { OperationEnvironment } from "@openbindings/ui-core";
import "./styles.css";

const LOCAL_SPEC = "example.vanilla-operation-invoker@1";

class VanillaOperationInvokerBinding implements BindingInvoker {
  bindingSpecs(): BindingSpecInfo[] {
    return [{ bindingSpec: LOCAL_SPEC }];
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
    let operation = "";
    let input: unknown;
    for await (const frame of invocation.inputs()) {
      if (frame.kind === "open") operation = frame.input.operation ?? "";
      if (frame.kind === "input") input = frame.value;
      if (frame.kind === "close") break;
    }
    await invocation.closeInput();
    await invocation.emitOutput({
      kind: "output",
      value: {
        id: "local-result",
        operation,
        input,
      },
    });
    await invocation.emitOutput({ kind: "complete" });
    invocation.closeOutput();
  }
}

const target: OBInterface = {
  openbindings: "0.2.0",
  name: "Example tasks",
  version: "1.0.0",
  description: "A small interface supplied as an ordinary element property.",
  operations: {
    "tasks.list": {
      description: "List tasks",
      tags: ["read"],
      output: {
        type: "array",
        items: { type: "object" },
      },
    },
    "tasks.create": {
      description: "Create a task",
      tags: ["write"],
      input: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      output: { type: "object" },
    },
  },
};

const provider: OBInterface = {
  ...structuredClone(operationInvokerInterface),
  sources: {
    local: { bindingSpec: LOCAL_SPEC, content: {} },
  },
  bindings: {
    invoke: {
      operation: "openbindings.operation-invoker.invokeOperation",
      source: "local",
      ref: "invoke",
    },
  },
};

const environment = new OperationEnvironment([
  {
    interface: provider,
    invoker: new OperationInvoker([new VanillaOperationInvokerBinding()]),
    label: "Vanilla local implementation",
  },
]);

const explorer = document.querySelector(
  "ob-obi-explorer",
) as OBIExplorerElement;
const detail = document.querySelector(
  "ob-operation-detail",
) as OperationDetailElement;
const workbench = document.querySelector(
  "ob-operation-workbench",
) as OperationWorkbenchElement;

explorer.obi = target;
detail.obi = target;
workbench.obi = target;
workbench.operationSource = environment;

explorer.addEventListener("ob-operation-select", event => {
  const key = event.detail.operationKey;
  detail.operationKey = key;
  workbench.operationKey = key;
});

explorer.selectedOperation = "tasks.create";
detail.operationKey = "tasks.create";
workbench.operationKey = "tasks.create";
workbench.inputText = '{"title":"Ship reusable elements"}';

globalThis.document.documentElement.dataset.ready = "true";
