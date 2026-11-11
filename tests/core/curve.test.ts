import { describe, expect, it } from "vitest";
import {
  LEVEL_CONFIGS,
  LEVEL_COUNT,
  LEVELS_PER_ZONE,
  LEVEL_VARIANTS,
  ZONES,
  variantForLevel
} from "../../src/core/curve.ts";

describe("level curve", () => {
  it("defines three 25-level zones", () => {
    expect(LEVEL_COUNT).toBe(75);
    expect(LEVELS_PER_ZONE).toBe(25);
    expect(LEVEL_CONFIGS).toHaveLength(LEVEL_COUNT);
    expect(ZONES).toHaveLength(3);
    LEVEL_CONFIGS.forEach((config, index) => expect(config.index).toBe(index));
    ZONES.forEach((zone, index) => {
      expect(zone.from).toBe(index * LEVELS_PER_ZONE);
      expect(zone.to).toBe((index + 1) * LEVELS_PER_ZONE - 1);
    });
  });

  it("starts with a 2x2 tutorial and ends on 6x6 with ten colours", () => {
    expect(LEVEL_CONFIGS[0]).toEqual({
      index: 0,
      size: 2,
      colors: 2,
      variant: "balanced"
    });
    expect(LEVEL_CONFIGS[LEVEL_COUNT - 1]).toEqual({
      index: LEVEL_COUNT - 1,
      size: 6,
      colors: 13,
      variant: "edge"
    });
  });

  it("keeps the tutorial row balanced and cycles five variants afterwards", () => {
    for (let i = 0; i < 5; i++) expect(LEVEL_CONFIGS[i].variant).toBe("balanced");
    for (let i = 5; i < LEVEL_COUNT; i++) {
      expect(LEVEL_CONFIGS[i].variant).toBe(variantForLevel(i));
      expect(LEVEL_CONFIGS[i].variant).toBe(LEVEL_VARIANTS[i % LEVEL_VARIANTS.length]);
    }
    expect(new Set(LEVEL_CONFIGS.map((config) => config.variant))).toEqual(
      new Set(LEVEL_VARIANTS)
    );
  });

  it("never makes the board or the colour count shrink", () => {
    for (let i = 1; i < LEVEL_COUNT; i++) {
      expect(LEVEL_CONFIGS[i].size).toBeGreaterThanOrEqual(LEVEL_CONFIGS[i - 1].size);
      expect(LEVEL_CONFIGS[i].colors).toBeGreaterThanOrEqual(LEVEL_CONFIGS[i - 1].colors);
    }
    expect(LEVEL_CONFIGS.some((config) => config.size > LEVEL_CONFIGS[0].size)).toBe(true);
    expect(LEVEL_CONFIGS.some((config) => config.colors > LEVEL_CONFIGS[0].colors)).toBe(true);
  });

  it("keeps every level physically generatable within the colour cap", () => {
    // The generator cuts each colour into a path of at least four squares.
    for (const config of LEVEL_CONFIGS) {
      expect(config.size).toBeGreaterThanOrEqual(2);
      expect(config.size).toBeLessThanOrEqual(6);
      expect(config.colors).toBeGreaterThanOrEqual(2);
      expect(config.colors).toBeLessThanOrEqual(13);
      expect(config.colors * 4).toBeLessThanOrEqual(3 * config.size ** 2);
    }
  });
});
