import { describe, expect, it } from "vitest";
import {
  configurationContext,
  mergeContext,
  partitionResolvedContext,
} from "./context-resolution.js";

describe("context resolution durability", () => {
  it("keeps absent and false durability transient while retaining explicit durable context", () => {
    expect(
      partitionResolvedContext([
        { value: { credentials: { oneShot: "token-1" } } },
        { durable: false, value: { configuration: { approval: "yes" } } },
        { durable: true, value: { credentials: { reusable: "token-2" } } },
      ]),
    ).toEqual({
      transient: {
        credentials: { oneShot: "token-1" },
        configuration: { approval: "yes" },
      },
      durable: { credentials: { reusable: "token-2" } },
    });
  });

  it("deep-merges named credentials and individual configuration points", () => {
    expect(
      mergeContext(
        {
          credentials: { first: "a" },
          configuration: { server: { url: "https://example.com" }, decode: "json" },
        },
        {
          credentials: { second: "b" },
          configuration: { server: { variables: { region: "east" } } },
        },
      ),
    ).toEqual({
      credentials: { first: "a", second: "b" },
      configuration: {
        server: { url: "https://example.com", variables: { region: "east" } },
        decode: "json",
      },
    });
  });

  it("constructs whole-point and nested config.value context", () => {
    expect(configurationContext("address", "", "/rooms/general")).toEqual({
      configuration: { address: "/rooms/general" },
    });
    expect(configurationContext("server", "/variables/region", "east")).toEqual({
      configuration: { server: { variables: { region: "east" } } },
    });
    expect(configurationContext("server", "/a~1b/~0key", "v")).toEqual({
      configuration: { server: { "a/b": { "~key": "v" } } },
    });
  });
});
