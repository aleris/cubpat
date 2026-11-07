import { FACES, PLAY_FACES } from "./layout.ts";
import type { Level } from "./levels.ts";

export type Point = { x: number; y: number };
/** Screen-space corners of one preview tile, in order around the quad. */
export type Quad = readonly [Point, Point, Point, Point];

/** Camera direction the game uses: looking from (1, 1, 1) at the origin. */
const VIEW = normalize([1, 1, 1]);
const RIGHT = normalize(cross([0, 1, 0], VIEW));
const UP = cross(VIEW, RIGHT);

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Orthographic projection; canvas y grows downwards. */
function project(x: number, y: number, z: number): Point {
  return {
    x: x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2],
    y: -(x * UP[0] + y * UP[1] + z * UP[2])
  };
}

/**
 * Screen-space quads of the level-screen mini cube: `[slot][row * n + col]`,
 * in layout square order, seen from the same (1, 1, 1) direction as the game.
 *
 * Under this projection the three visible faces are congruent rhombi, so every
 * tile is the same shape rotated by a multiple of 60 degrees and a uniform
 * inset per tile gives every face the same visual gap. Drawing the tiles
 * themselves (instead of a CSS 3D grid of elements) also keeps the seams from
 * rounding differently tile by tile.
 */
export function miniQuads(level: Level): Quad[][] {
  const n = level.size;
  const faces: Quad[][] = [];
  for (let slot = 0; slot < PLAY_FACES.length; slot++) {
    const basis = FACES[PLAY_FACES[slot]];
    const quads: Quad[] = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const u0 = col / n - 0.5;
        const u1 = (col + 1) / n - 0.5;
        const v0 = row / n - 0.5;
        const v1 = (row + 1) / n - 0.5;
        const corner = (u: number, v: number): Point =>
          project(
            basis.n[0] * 0.5 + basis.u[0] * u + basis.v[0] * v,
            basis.n[1] * 0.5 + basis.u[1] * u + basis.v[1] * v,
            basis.n[2] * 0.5 + basis.u[2] * u + basis.v[2] * v
          );
        quads.push([corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)]);
      }
    }
    faces.push(quads);
  }
  return faces;
}
