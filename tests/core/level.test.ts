import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS, LEVEL_COUNT } from "../../src/core/curve.ts";
import { areAdjacent } from "../../src/core/layout.ts";
import { generateLevel, solvedColors, validateLevel, type Level } from "../../src/core/level.ts";
import { colorFor } from "../../src/core/palette.ts";

const SEEDS = [0, 1, 12345, 0xdeadbeef, 0xffffffff];

function assertLevelShape(level: Level): void {
  const { layout, colors } = level;
  expect(level.layout.count).toBe(3 * level.size ** 2);
  expect(level.endpoints).toHaveLength(colors);
  expect(level.solution).toHaveLength(colors);
  expect(level.palette).toHaveLength(colors);
  expect(level.initial).toHaveLength(layout.count);

  const colored = Array.from(level.initial).filter((owner) => owner >= 0);
  expect(colored).toHaveLength(colors * 2);

  const pairs = level.endpoints.flat();
  expect(new Set(pairs).size).toBe(pairs.length);

  for (let color = 0; color < colors; color++) {
    const [a, b] = level.endpoints[color];
    expect(a).not.toBe(b);
    expect(level.initial[a]).toBe(color);
    expect(level.initial[b]).toBe(color);
    expect(level.palette[color]).toBe(colorFor(color));
    expect(areAdjacent(layout, a, b)).toBe(false);

    const path = level.solution[color];
    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(path[0]).toBe(a);
    expect(path[path.length - 1]).toBe(b);
    for (let i = 1; i < path.length; i++) {
      expect(areAdjacent(layout, path[i - 1], path[i])).toBe(true);
    }
  }

  const covered = level.solution.flat();
  expect(covered).toHaveLength(layout.count);
  expect(new Set(covered).size).toBe(layout.count);
  expect(validateLevel(level)).toEqual({ ok: true, errors: [] });
}

describe("generateLevel", () => {
  it("builds every level for every seed from the endpoint pairs", () => {
    for (const seed of SEEDS) {
      for (const config of LEVEL_CONFIGS) {
        const level = generateLevel(config, seed);
        expect(level.index).toBe(config.index);
        expect(level.size).toBe(config.size);
        expect(level.colors).toBe(config.colors);
        assertLevelShape(level);
      }
    }
  }, 60_000);

  it("replays the exact same level for the same seed and index", () => {
    for (const config of LEVEL_CONFIGS) {
      const level = generateLevel(config, 0xdeadbeef);
      const again = generateLevel(config, 0xdeadbeef);
      expect(again.endpoints).toEqual(level.endpoints);
      expect(again.solution).toEqual(level.solution);
      expect(again.initial).toEqual(level.initial);
      expect(again.palette).toEqual(level.palette);
    }
  }, 30_000);

  it("uses the master seed and level index to choose different levels", () => {
    for (const index of [0, 4, LEVEL_COUNT - 1]) {
      const config = LEVEL_CONFIGS[index];
      const layouts = new Set(
        SEEDS.map((seed) => JSON.stringify(generateLevel(config, seed).endpoints))
      );
      expect(layouts.size).toBeGreaterThan(1);
    }
  }, 30_000);

  it("throws for a configuration the path split cannot satisfy", () => {
    expect(() => generateLevel({ index: 0, size: 2, colors: 10 }, 0)).toThrow(/generation failed/);
  }, 30_000);
});

describe("solvedColors", () => {
  it("paints every square with the colour of the path that owns it", () => {
    const level = generateLevel(LEVEL_CONFIGS[7], 12345);
    const solved = solvedColors(level);
    expect(solved).toHaveLength(level.layout.count);
    expect(Array.from(solved).includes(-1)).toBe(false);

    const expected = new Map<number, number>();
    level.solution.forEach((path, color) => {
      for (const square of path) expected.set(square, color);
    });
    for (let square = 0; square < level.layout.count; square++) {
      expect(solved[square]).toBe(expected.get(square));
    }
  }, 30_000);
});
