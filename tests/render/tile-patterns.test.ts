import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS } from "../../src/core/curve.ts";
import { PATTERN_COUNT } from "../../src/render/tile-patterns.ts";

describe("tile patterns", () => {
  it("has a distinct motif for every colour a level can use", () => {
    const maxColors = Math.max(...LEVEL_CONFIGS.map((config) => config.colors));
    expect(PATTERN_COUNT).toBeGreaterThanOrEqual(maxColors);
  });
});
