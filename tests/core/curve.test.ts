import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS, LEVEL_COUNT } from "../../src/core/curve.ts";

describe("level curve", () => {
  it("defines 25 indexed levels", () => {
    expect(LEVEL_COUNT).toBe(25);
    expect(LEVEL_CONFIGS).toHaveLength(LEVEL_COUNT);
    LEVEL_CONFIGS.forEach((config, index) => expect(config.index).toBe(index));
  });

  it("starts with a 2x2 two-colour tutorial and ends on 6x6 with fifteen colours", () => {
    expect(LEVEL_CONFIGS[0]).toEqual({ index: 0, size: 2, colors: 2 });
    expect(LEVEL_CONFIGS[LEVEL_COUNT - 1]).toEqual({
      index: LEVEL_COUNT - 1,
      size: 6,
      colors: 15
    });
  });

  it("never makes the board or the colour count shrink", () => {
    for (let i = 1; i < LEVEL_COUNT; i++) {
      expect(LEVEL_CONFIGS[i].size).toBeGreaterThanOrEqual(LEVEL_CONFIGS[i - 1].size);
      expect(LEVEL_CONFIGS[i].colors).toBeGreaterThanOrEqual(LEVEL_CONFIGS[i - 1].colors);
    }
    expect(LEVEL_CONFIGS.some((config) => config.size > LEVEL_CONFIGS[0].size)).toBe(true);
    expect(LEVEL_CONFIGS.some((config) => config.colors > LEVEL_CONFIGS[0].colors)).toBe(true);
  });

  it("keeps every level physically generatable", () => {
    // The generator cuts each colour into a path of at least four squares.
    for (const config of LEVEL_CONFIGS) {
      expect(config.size).toBeGreaterThanOrEqual(2);
      expect(config.size).toBeLessThanOrEqual(6);
      expect(config.colors).toBeGreaterThanOrEqual(2);
      expect(config.colors * 4).toBeLessThanOrEqual(3 * config.size ** 2);
    }
  });
});
