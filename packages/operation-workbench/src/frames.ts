import type { OBInterface } from "@openbindings/sdk";

export interface BindingInvocationInput {
  source: {
    bindingSpec: string;
    location?: string;
    content?: unknown;
  };
  selector: string;
  context?: Record<string, unknown>;
}

export interface OperationInvocationInput {
  interface: OBInterface;
  operation?: string;
  binding?: string;
  context?: Record<string, unknown>;
}

export type OperationInvokerInputFrame =
  | { kind: "open"; input: OperationInvocationInput }
  | { kind: "input"; value: unknown }
  | { kind: "close" };

export type BindingInvokerInputFrame =
  | { kind: "open"; input: BindingInvocationInput }
  | { kind: "input"; value: unknown }
  | { kind: "close" };

export type InvocationInputFrame =
  | OperationInvokerInputFrame
  | BindingInvokerInputFrame;

export interface OperationFrameError {
  code: string;
  data?: unknown;
}

export type OperationInvokerOutputFrame =
  | { kind: "output"; value: unknown }
  | { kind: "input_closed" }
  | { kind: "complete" }
  | { kind: "error"; error: OperationFrameError };

export type BindingInvokerOutputFrame = OperationInvokerOutputFrame;
