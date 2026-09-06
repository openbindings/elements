import {
  operationRequirement,
  operationSignature,
  type OBInterface,
} from "@openbindings/sdk";
import operationInvokerInterfaceJSON from "./requirements/operation-invoker.json";
import bindingInvokerInterfaceJSON from "./requirements/binding-invoker.json";
import type {
  BindingInvokerInputFrame,
  BindingInvokerOutputFrame,
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";

export const OPERATION_INVOKER_OPERATION =
  "openbindings.operation-invoker.invokeOperation";
export const BINDING_INVOKER_OPERATION =
  "openbindings.binding-invoker.invokeBinding";

/** Canonical published interface copied from openbindings/interfaces. */
export const operationInvokerInterface =
  operationInvokerInterfaceJSON as OBInterface;

/** Canonical published interface copied from openbindings/interfaces. */
export const bindingInvokerInterface =
  bindingInvokerInterfaceJSON as OBInterface;

/** The one external capability the invocation workbench requires. */
export const invokeOperationRequirement = operationRequirement(
  operationInvokerInterface,
  operationSignature<
    OperationInvokerInputFrame,
    OperationInvokerOutputFrame
  >(OPERATION_INVOKER_OPERATION),
);

/** Optional lower-level capability used only when a user explicitly explores a binding. */
export const invokeBindingRequirement = operationRequirement(
  bindingInvokerInterface,
  operationSignature<BindingInvokerInputFrame, BindingInvokerOutputFrame>(
    BINDING_INVOKER_OPERATION,
  ),
);
