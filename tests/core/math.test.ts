import { describe, expect, it } from "vitest";
import {
  clamp,
  cross,
  dot,
  madd,
  normalize,
  quatIdentity,
  quatMul,
  quatRotate,
  type Quat,
  type Vec3
} from "../../src/core/math.ts";

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const closeVec = (a: readonly number[], b: readonly number[], eps = 1e-9): boolean =>
  a.length === b.length && a.every((value, i) => close(value, b[i], eps));
const length = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

/** Rotation of `angle` radians about `axis`, in the same layout quatMul uses. */
function quatFromAxis(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

describe("vectors", () => {
  it("crosses right-handed and anticommutes", () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1]);
    const a: Vec3 = [2, -3, 5];
    const b: Vec3 = [-1, 4, 0.5];
    expect(closeVec(cross(a, b), cross(b, a).map((value) => -value))).toBe(true);
    expect(closeVec(
      cross(a, b),
      [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    )).toBe(true);
  });

  it("dots orthogonal and parallel vectors", () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(dot([2, 3, -1], [2, 3, -1])).toBe(14);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it("adds a scaled vector without mutating the inputs", () => {
    const a: Vec3 = [1, 2, 3];
    const b: Vec3 = [4, 5, 6];
    expect(madd(a, b, 0.5)).toEqual([3, 4.5, 6]);
    expect(madd(a, b, -1)).toEqual([-3, -3, -3]);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([4, 5, 6]);
  });

  it("normalizes to unit length", () => {
    const n = normalize([3, 4, 0]);
    expect(closeVec(n, [0.6, 0.8, 0])).toBe(true);
    expect(close(length(n), 1)).toBe(true);
    expect(normalize([0, 0, -5])).toEqual([0, 0, -1]);
  });

  it("clamps on both bounds", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(0.5, 0, 0.25)).toBe(0.25);
  });
});

describe("quaternions", () => {
  it("keeps the identity inert", () => {
    const v: Vec3 = [0.3, -1.2, 4];
    expect(quatIdentity()).toEqual([0, 0, 0, 1]);
    expect(closeVec(quatRotate(quatIdentity(), v), v)).toBe(true);
  });

  it("rotates a quarter turn about Z as a right-handed rotation", () => {
    const q = quatFromAxis([0, 0, 1], Math.PI / 2);
    expect(closeVec(quatRotate(q, [1, 0, 0]), [0, 1, 0])).toBe(true);
    expect(closeVec(quatRotate(q, [0, 1, 0]), [-1, 0, 0])).toBe(true);
    expect(closeVec(quatRotate(q, [0, 0, 1]), [0, 0, 1])).toBe(true);
  });

  it("preserves vector length", () => {
    const q = quatFromAxis([1, -2, 0.5], 1.234);
    const v: Vec3 = [5, -1, 3];
    expect(close(length(quatRotate(q, v)), length(v))).toBe(true);
  });

  it("composes rotations as q = a * b, applying b first", () => {
    const a = quatFromAxis([0, 0, 1], Math.PI / 2);
    const b = quatFromAxis([1, 0, 0], Math.PI / 2);
    const v: Vec3 = [1, 2, 3];
    const composed = quatRotate(quatMul(a, b), v);
    const sequential = quatRotate(a, quatRotate(b, v));
    expect(closeVec(composed, sequential, 1e-12)).toBe(true);
  });

  it("does not commute in general", () => {
    const a = quatFromAxis([0, 0, 1], 0.4);
    const b = quatFromAxis([1, 0, 0], 0.9);
    const v: Vec3 = [1, 2, 3];
    expect(closeVec(quatRotate(quatMul(a, b), v), quatRotate(quatMul(b, a), v), 1e-9)).toBe(false);
  });
});
