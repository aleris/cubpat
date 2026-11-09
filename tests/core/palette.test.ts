import { describe, expect, it } from "vitest";
import { colorFor, hslToHex } from "../../src/core/palette.ts";

describe("hslToHex", () => {
  it("converts the primary and neutral colours", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(200, 0, 0.5)).toBe("#808080");
  });

  it("wraps hue into [0, 360)", () => {
    expect(hslToHex(360, 0.7, 0.4)).toBe(hslToHex(0, 0.7, 0.4));
    expect(hslToHex(-120, 0.7, 0.4)).toBe(hslToHex(240, 0.7, 0.4));
    expect(hslToHex(480, 0.7, 0.4)).toBe(hslToHex(120, 0.7, 0.4));
  });

  it("always emits a lowercase #rrggbb triple", () => {
    for (let hue = -180; hue <= 540; hue += 15) {
      expect(hslToHex(hue, 0.83, 0.58)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("clamps lightness outside [0, 1]", () => {
    expect(hslToHex(0, 1, 2)).toBe("#ffffff");
    expect(hslToHex(0, 1, -1)).toBe("#000000");
  });
});

describe("colorFor", () => {
  it("wraps around the palette", () => {
    for (let i = 0; i < 20; i++) expect(colorFor(i + 20)).toBe(colorFor(i));
  });

  it("keeps the first twenty colours distinct", () => {
    const colors = Array.from({ length: 20 }, (_, i) => colorFor(i));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("is stable", () => {
    expect(colorFor(3)).toBe(colorFor(3));
    expect(colorFor(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
