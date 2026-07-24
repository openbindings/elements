import {
  operationRequirement,
  operationSignature,
  type OBInterface,
} from "@openbindings/sdk";
import operationInvokerInterfaceJSON from "./requirements/operation-invoker.json";
import type {
  OperationInvokerInputFrame,
  OperationInvokerOutputFrame,
} from "./frames.js";

export const OPERATION_INVOKER_OPERATION =
  "openbindings.operation-invoker.invokeOperation";

/** Canonical published interface copied from openbindings/interfaces. */
export const operationInvokerInterface =
  operationInvokerInterfaceJSON as OBInterface;

/** The one external capability the invocation workbench requires. */
export const invokeOperationRequirement = operationRequirement(
  operationInvokerInterface,
  operationSignature<
    OperationInvokerInputFrame,
    OperationInvokerOutputFrame
  >(OPERATION_INVOKER_OPERATION),
);
