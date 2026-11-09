import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS, LEVEL_COUNT } from "../../src/core/curve.ts";
import { FACES, PLAY_FACES, buildLayout } from "../../src/core/layout.ts";
import { generateLevel } from "../../src/core/level.ts";
import { miniQuads, type Point } from "../../src/core/preview.ts";

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point): number => Math.hypot(v.x, v.y);
const near = (a: number, b: number): boolean => close(a, b, 1e-9);

function shape(quad: readonly Point[]): [number, number, number] {
  const e1 = sub(quad[1], quad[0]);
  const e2 = sub(quad[3], quad[0]);
  return [len(e1), len(e2), Math.abs(e1.x * e2.y - e1.y * e2.x)];
}

describe("miniQuads", () => {
  it("draws the three camera-facing faces as congruent rhombi", () => {
    for (const config of LEVEL_CONFIGS) {
      const level = generateLevel(config, 12345);
      const n = level.size;
      const quads = miniQuads(level);
      expect(quads).toHaveLength(3);

      let reference: [number, number, number] | null = null;
      quads.forEach((face, slot) => {
        const normal = FACES[PLAY_FACES[slot]].n;
        expect(normal[0] + normal[1] + normal[2]).toBeGreaterThan(0);
        expect(face).toHaveLength(n * n);

        for (const quad of face) {
          const [edgeA, edgeB, area] = shape(quad);
          expect(area).toBeGreaterThan(1e-9);
          expect(near(len(sub(quad[1], quad[0])), len(sub(quad[2], quad[3])))).toBe(true);
          reference ??= [edgeA, edgeB, area];
          expect(near(edgeA, reference[0])).toBe(true);
          expect(near(edgeB, reference[1])).toBe(true);
          expect(near(area, reference[2])).toBe(true);
        }
      });
    }
  }, 60_000);

  it("shares an exact edge between squares that touch on the cube", () => {
    for (const config of [LEVEL_CONFIGS[0], LEVEL_CONFIGS[7], LEVEL_CONFIGS[LEVEL_COUNT - 1]]) {
      const level = generateLevel(config, 12345);
      const n = level.size;
      const layout = buildLayout(n);
      const quads = miniQuads(level);
      const squares = new Map<number, readonly Point[]>();
      quads.forEach((face, slot) => {
        face.forEach((quad, index) => squares.set(slot * n * n + index, quad));
      });

      for (let square = 0; square < layout.count; square++) {
        for (let dir = 0; dir < 4; dir++) {
          const other = layout.next[square * 4 + dir];
          if (other < 0 || other < square) continue;
          const a = squares.get(square)!;
          const b = squares.get(other)!;
          let shared = 0;
          for (const p of a) {
            if (b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9)) shared++;
          }
          expect(shared).toBe(2);
        }
      }
    }
  }, 60_000);
});
