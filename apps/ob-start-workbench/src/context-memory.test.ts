import { expect, it } from "vitest";
import { ContextMemory, matchingRetryContext } from "./context-memory.js";

it("never carries retry-chain context across opaque scope changes", () => {
  const context = { bearerToken: "sentinel", configuration: { choice: "a" } };
  expect(matchingRetryContext("a", "a", context)).toEqual(context);
  expect(matchingRetryContext("a", "b", context)).toBeNull();
  expect(matchingRetryContext("https://a", "https://a/", context)).toBeNull();
  expect(matchingRetryContext(null, "a", context)).toBeNull();
  expect(matchingRetryContext("", "", context)).toBeNull();
});

it("reuses durable values only after an exact target and requirement match", () => {
  const memory = new ContextMemory();
  const requirement = { type: "auth.apiKey", name: "TestKey", durable: true };
  memory.remember("https://a.example", requirement, { apiKey: "sentinel" });
  expect(memory.recall("https://a.example", requirement)).toEqual({ apiKey: "sentinel" });
  expect(memory.recall("https://b.example", requirement)).toEqual({});
  expect(memory.recall("https://a.example", { ...requirement, name: "Other" })).toEqual({});
  const copy = memory.recall("https://a.example", requirement);
  copy.apiKey = "mutated";
  expect(memory.recall("https://a.example", requirement).apiKey).toBe("sentinel");
  memory.clear();
  expect(memory.recall("https://a.example", requirement)).toEqual({});
});

it("does not remember absent/false durability or an unresolved target", () => {
  const memory = new ContextMemory();
  for (const durable of [undefined, false]) {
    const requirement = { type: "auth.bearer", ...(durable === false ? { durable } : {}) };
    memory.remember("a", requirement, { bearerToken: "secret" });
    expect(memory.recall("a", requirement)).toEqual({});
  }
  const requirement = { type: "auth.bearer", durable: true };
  memory.remember("", requirement, { bearerToken: "secret" });
  expect(memory.recall("", requirement)).toEqual({});
});
