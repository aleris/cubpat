import { describe, expect, it } from "vitest";
import { hashString, mulberry32, randomInt, seedForLevel, shuffleInPlace } from "../../src/core/rng.ts";

describe("hashString", () => {
  it("matches FNV-1a 32-bit for known inputs", () => {
    expect(hashString("")).toBe(2166136261);
    expect(hashString("a")).toBe(0xe40c292c);
  });

  it("is deterministic and stays an unsigned 32-bit integer", () => {
    for (const value of ["", "a", "seed:1", "seed:1:0", "cubpat"]) {
      expect(hashString(value)).toBe(hashString(value));
      expect(hashString(value)).toBeGreaterThanOrEqual(0);
      expect(hashString(value)).toBeLessThan(2 ** 32);
      expect(Number.isInteger(hashString(value))).toBe(true);
    }
  });

  it("changes when the input changes", () => {
    expect(hashString("seed:1:0")).not.toBe(hashString("seed:1:1"));
    expect(hashString("0:1:0")).not.toBe(hashString("1:1:0"));
  });
});

describe("mulberry32", () => {
  it("replays the same sequence for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("produces numbers in [0, 1)", () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("diverges for different seeds and normalizes the seed to uint32", () => {
    const a = mulberry32(7);
    const b = mulberry32(8);
    expect(a()).not.toBe(b());
    expect(mulberry32(1)()).toBe(mulberry32(1 + 2 ** 32)());
  });
});

describe("seedForLevel", () => {
  it("separates master seed, level and attempt", () => {
    const base = seedForLevel(42, 3, 0);
    expect(seedForLevel(42, 3, 0)).toBe(base);
    expect(seedForLevel(43, 3, 0)).not.toBe(base);
    expect(seedForLevel(42, 4, 0)).not.toBe(base);
    expect(seedForLevel(42, 3, 1)).not.toBe(base);
  });

  it("treats the master seed as unsigned", () => {
    expect(seedForLevel(-1, 0, 0)).toBe(seedForLevel(0xffffffff, 0, 0));
  });
});

describe("randomInt", () => {
  it("stays within the half-open range", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const value = randomInt(rng, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
    expect(randomInt(() => 0.999999, 1)).toBe(0);
  });
});

describe("shuffleInPlace", () => {
  it("permutes in place and keeps every element", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const returned = shuffleInPlace(mulberry32(4), items);
    expect(returned).toBe(items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(items).not.toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("is deterministic for the same RNG sequence", () => {
    const a = shuffleInPlace(mulberry32(5), [0, 1, 2, 3, 4, 5]);
    const b = shuffleInPlace(mulberry32(5), [0, 1, 2, 3, 4, 5]);
    expect(a).toEqual(b);
  });

  it("leaves empty and single-element arrays alone", () => {
    expect(shuffleInPlace(mulberry32(1), [])).toEqual([]);
    expect(shuffleInPlace(mulberry32(1), ["x"])).toEqual(["x"]);
  });
});
