import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    restoreMocks: true,
  },
});
