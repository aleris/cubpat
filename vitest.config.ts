import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Whole-level generation and exhaustive covering search dominate the suite;
    // the assertions themselves are deterministic and fast.
    testTimeout: 60_000
  }
});
