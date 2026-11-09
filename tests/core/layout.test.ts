import { describe, expect, it } from "vitest";
import {
  DIRS,
  FACES,
  FACES_PER_VIEW,
  F_NX,
  F_NY,
  F_NZ,
  PLAY_FACES,
  areAdjacent,
  buildLayout,
  neighborCount,
  oppositeFace,
  projectToSquare,
  slotOfFace,
  squareIndex,
  type CubeLayout
} from "../../src/core/layout.ts";
import { cross, dot, type Vec3 } from "../../src/core/math.ts";

const SIZES = [2, 3, 4, 5, 6];
const HIDDEN = [F_NX, F_NY, F_NZ];
const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const closeVec = (a: readonly number[], b: readonly number[], eps = 1e-9): boolean =>
  a.every((value, i) => close(value, b[i], eps));
const length = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

function degrees(layout: CubeLayout): Map<number, number> {
  const counts = new Map<number, number>();
  for (let square = 0; square < layout.count; square++) {
    const degree = neighborCount(layout, square);
    counts.set(degree, (counts.get(degree) ?? 0) + 1);
  }
  return counts;
}

function reachedSquares(layout: CubeLayout): Set<number> {
  const reached = new Set([0]);
  const stack = [0];
  while (stack.length > 0) {
    const square = stack.pop()!;
    for (let dir = 0; dir < 4; dir++) {
      const next = layout.next[square * 4 + dir];
      if (next >= 0 && !reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  return reached;
}

describe("face definitions", () => {
  it("has orthogonal, outward-facing unit bases", () => {
    expect(FACES).toHaveLength(6);
    for (const basis of FACES) {
      expect(close(length(basis.n), 1)).toBe(true);
      expect(close(length(basis.u), 1)).toBe(true);
      expect(close(length(basis.v), 1)).toBe(true);
      expect(closeVec(cross(basis.u, basis.v), basis.n)).toBe(true);
      expect(close(dot(basis.u, basis.n), 0)).toBe(true);
      expect(close(dot(basis.v, basis.n), 0)).toBe(true);
    }
  });

  it("pairs opposite faces and exposes exactly three play slots", () => {
    for (let face = 0; face < 6; face++) {
      expect(oppositeFace(oppositeFace(face))).toBe(face);
      expect(oppositeFace(face)).not.toBe(face);
    }
    PLAY_FACES.forEach((face, slot) => expect(slotOfFace(face)).toBe(slot));
    for (const face of HIDDEN) expect(slotOfFace(face)).toBe(-1);
    expect(FACES_PER_VIEW).toBe(3);
    expect(new Set(PLAY_FACES).size).toBe(3);
  });

  it("uses unit cardinal directions", () => {
    expect(DIRS).toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]);
  });
});

describe.each(SIZES)("layout %i", (size) => {
  const layout = buildLayout(size);

  it("covers the three play faces with unique indexed squares", () => {
    expect(layout.size).toBe(size);
    expect(layout.count).toBe(3 * size * size);
    expect(layout.center).toHaveLength(layout.count * 3);
    expect(layout.next).toHaveLength(layout.count * 4);

    const seen = new Set<number>();
    for (let square = 0; square < layout.count; square++) {
      expect(PLAY_FACES).toContain(layout.face[square]);
      expect(layout.face[square]).toBe(PLAY_FACES[layout.slot[square]]);
      expect(layout.row[square]).toBeGreaterThanOrEqual(0);
      expect(layout.row[square]).toBeLessThan(size);
      expect(layout.col[square]).toBeGreaterThanOrEqual(0);
      expect(layout.col[square]).toBeLessThan(size);
      expect(squareIndex(size, layout.slot[square], layout.row[square], layout.col[square])).toBe(square);
      expect(seen.has(square)).toBe(false);
      seen.add(square);

      const cx = layout.center[square * 3];
      const cy = layout.center[square * 3 + 1];
      const cz = layout.center[square * 3 + 2];
      expect(Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz))).toBeCloseTo(0.5, 6);
      expect([cx, cy, cz].every((value) => value >= -0.5 && value <= 0.5)).toBe(true);
    }
    expect(seen.size).toBe(layout.count);
  });

  it("links mutual, in-range neighbours with no duplicates", () => {
    for (let square = 0; square < layout.count; square++) {
      const neighbours = new Set<number>();
      for (let dir = 0; dir < 4; dir++) {
        const next = layout.next[square * 4 + dir];
        if (next < 0) continue;
        expect(next).toBeLessThan(layout.count);
        expect(next).not.toBe(square);
        expect(neighbours.has(next)).toBe(false);
        neighbours.add(next);
        expect(areAdjacent(layout, next, square)).toBe(true);
        expect(areAdjacent(layout, square, next)).toBe(true);
      }
      expect(neighbours.size).toBe(neighborCount(layout, square));
    }
  });

  it("has the corner / border / interior degree distribution of a 3-face patch", () => {
    const counts = degrees(layout);
    expect(counts.get(2)).toBe(3);
    expect(counts.get(3)).toBe(6 * (size - 1));
    expect(counts.get(4)).toBe(3 * (size - 1) ** 2);
    expect([...counts.keys()].sort()).toEqual([2, 3, 4]);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(layout.count);
  });

  it("forms one connected patch", () => {
    expect(reachedSquares(layout).size).toBe(layout.count);
  });

  it("projects square centres and their outward points back onto the same square", () => {
    for (let square = 0; square < layout.count; square++) {
      const x = layout.center[square * 3];
      const y = layout.center[square * 3 + 1];
      const z = layout.center[square * 3 + 2];
      expect(projectToSquare(size, x, y, z)).toBe(square);
      const n = FACES[layout.face[square]].n;
      expect(projectToSquare(size, x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01)).toBe(square);
    }
  });

  it("never projects points on hidden faces into the play field", () => {
    for (const face of HIDDEN) {
      const n: Vec3 = FACES[face].n;
      expect(projectToSquare(size, n[0] * 0.5, n[1] * 0.5, n[2] * 0.5)).toBe(-1);
      expect(projectToSquare(size, n[0], n[1], n[2])).toBe(-1);
    }
    for (const face of PLAY_FACES) {
      const n = FACES[face].n;
      expect(projectToSquare(size, n[0] * 0.5, n[1] * 0.5, n[2] * 0.5)).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports non-neighbours and out-of-range squares as non-adjacent", () => {
    expect(areAdjacent(layout, -1, 0)).toBe(false);
    expect(areAdjacent(layout, 0, -1)).toBe(false);
    const neighbours = new Set<number>();
    for (let dir = 0; dir < 4; dir++) {
      const next = layout.next[dir];
      if (next >= 0) neighbours.add(next);
    }
    const far = Array.from({ length: layout.count }, (_, square) => square).find(
      (square) => square !== 0 && !neighbours.has(square)
    );
    if (far === undefined) throw new Error("expected a square outside square 0's neighbourhood");
    expect(areAdjacent(layout, 0, far)).toBe(false);
    expect(areAdjacent(layout, far, 0)).toBe(false);
  });
});
