import type { OBInterface } from "@openbindings/sdk";

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

export interface OperationFrameError {
  code: string;
  message: string;
  category: string;
  details?: unknown;
  effects?: "none" | "possible" | "definite";
}

export type OperationInvokerOutputFrame =
  | { kind: "output"; value: unknown }
  | { kind: "input_closed" }
  | { kind: "complete" }
  | { kind: "error"; error: OperationFrameError };
