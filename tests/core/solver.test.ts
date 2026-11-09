import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS } from "../../src/core/curve.ts";
import { generateLevel, type Level } from "../../src/core/level.ts";
import {
  checkPairsConnected,
  checkSolution,
  countCovering,
  solveCovering
} from "../../src/core/solver.ts";

const SEEDS = [0, 1, 12345, 0xdeadbeef, 0xffffffff];

function firstLevel(): Level {
  return generateLevel(LEVEL_CONFIGS[0], 12345);
}

describe("generated levels", () => {
  it("expose endpoint pairs a legal covering solution can join", () => {
    for (const seed of SEEDS) {
      for (const config of LEVEL_CONFIGS) {
        const level = generateLevel(config, seed);
        expect(checkPairsConnected(level)).toEqual([]);
        expect(checkSolution(level, level.solution)).toEqual([]);
      }
    }
  }, 60_000);

  it("can be solved from the endpoint pairs alone on boards up to 4x4", () => {
    for (const seed of SEEDS) {
      for (const config of LEVEL_CONFIGS.filter((config) => 3 * config.size ** 2 <= 48)) {
        const level = generateLevel(config, seed);
        const paths = solveCovering(level, { maxNodes: 40_000_000 });
        expect(paths).not.toBeNull();
        if (!paths) continue;
        expect(checkSolution(level, paths)).toEqual([]);
        expect(new Set(paths.flat()).size).toBe(level.layout.count);
      }
    }
  }, 60_000);
});

describe("checkSolution", () => {
  it("accepts the generator's solution", () => {
    const level = firstLevel();
    expect(checkSolution(level, level.solution)).toEqual([]);
  });

  it("rejects a missing colour", () => {
    const level = firstLevel();
    const paths = level.solution.map((path) => path.slice()).slice(0, -1);
    expect(checkSolution(level, paths).some((error) => error.includes("expected"))).toBe(true);
  });

  it("rejects a two-square path whose endpoints are not adjacent", () => {
    const level = firstLevel();
    const paths = level.solution.map((path) => path.slice());
    paths[0] = [level.endpoints[0][0], level.endpoints[0][1]];
    expect(checkSolution(level, paths).some((error) => error.includes("not adjacent"))).toBe(true);
  });

  it("rejects a path that does not start on its endpoint", () => {
    const level = firstLevel();
    const paths = level.solution.map((path) => path.slice());
    paths[1] = paths[0].slice();
    const errors = checkSolution(level, paths);
    expect(errors.some((error) => error.includes("does not start on its endpoint"))).toBe(true);
    expect(errors.some((error) => error.includes("used by two colours"))).toBe(true);
  });

  it("rejects a path shorter than two squares and leaves squares uncoloured", () => {
    const level = firstLevel();
    const paths = level.solution.map((path) => path.slice());
    paths[0] = [level.endpoints[0][0]];
    const errors = checkSolution(level, paths);
    expect(errors.some((error) => error.includes("path shorter than two squares"))).toBe(true);
    expect(errors.some((error) => error.includes("left uncoloured"))).toBe(true);
  });
});

describe("checkPairsConnected", () => {
  it("flags a pair whose target is owned by another colour", () => {
    const level = firstLevel();
    const [a, b] = level.endpoints[0];
    const overlapping: Level = { ...level, endpoints: [[a, b], [a, b]] };
    const errors = checkPairsConnected(overlapping);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("colour 0");
    expect(errors[0]).toContain("not connectable");
  });
});

describe("countCovering", () => {
  it("keeps the tutorial nearly forced", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(LEVEL_CONFIGS[0], seed);
      const partitions = countCovering(level, 64);
      expect(partitions).toBeGreaterThanOrEqual(1);
      expect(partitions).toBeLessThanOrEqual(8);
    }
  }, 30_000);

  it("respects its cap", () => {
    const level = firstLevel();
    expect(countCovering(level, 1)).toBe(1);
  });
});
