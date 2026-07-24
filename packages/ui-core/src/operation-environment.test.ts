import type { OperationImplementation } from "@openbindings/sdk";
import { describe, expect, it, vi } from "vitest";
import { OperationEnvironment } from "./operation-environment.js";

describe("OperationEnvironment", () => {
  it("publishes immutable snapshots and explicit replacement notifications", () => {
    const first = { label: "first" } as OperationImplementation;
    const second = { label: "second" } as OperationImplementation;
    const environment = new OperationEnvironment([first]);
    const listener = vi.fn();
    const unsubscribe = environment.subscribe(listener);

    expect(environment.snapshot()).toEqual([first]);
    expect(Object.isFrozen(environment.snapshot())).toBe(true);

    environment.replace([second]);
    expect(environment.snapshot()).toEqual([second]);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    environment.replace([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
