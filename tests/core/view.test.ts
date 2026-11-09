import { describe, expect, it } from "vitest";
import { FACES, PLAY_FACES, buildLayout } from "../../src/core/layout.ts";
import { quatIdentity, quatRotate, type Quat, type Vec3 } from "../../src/core/math.ts";
import { TILT_MAX, VIEW_DIR, tiltQuat, visibleFaceCount } from "../../src/core/view.ts";

const PLAY = new Set<number>(PLAY_FACES);
const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const length = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);
const normalize = (v: Vec3): Vec3 => {
  const len = length(v);
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Rotated tilt angle in radians. `tiltQuat` always returns w >= 0. */
function tiltAngle(q: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

function quatFromAxis(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

function visibleFaces(q: Quat): number[] {
  const visible: number[] = [];
  FACES.forEach((basis, face) => {
    const n = quatRotate(q, basis.n);
    if (n[0] * VIEW_DIR[0] + n[1] * VIEW_DIR[1] + n[2] * VIEW_DIR[2] > 1e-6) visible.push(face);
  });
  return visible;
}

describe("view direction", () => {
  it("looks down the (1,1,1) diagonal", () => {
    expect(length(VIEW_DIR)).toBeCloseTo(1, 12);
    expect(VIEW_DIR[0]).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(VIEW_DIR[1]).toBe(VIEW_DIR[0]);
    expect(VIEW_DIR[2]).toBe(VIEW_DIR[0]);
  });
});

describe("tiltQuat", () => {
  it("is the identity at the origin or on the camera axis", () => {
    expect(tiltQuat([0, 0, 0])).toEqual(quatIdentity());
    expect(tiltQuat([...VIEW_DIR])).toEqual(quatIdentity());
  });

  it("caps the rotation at the requested angle", () => {
    const q = tiltQuat([1, 0, 0]);
    expect(tiltAngle(q)).toBeCloseTo(TILT_MAX, 12);
    expect(tiltAngle(tiltQuat([1, 0, 0], 0))).toBeCloseTo(0, 12);
    expect(tiltAngle(tiltQuat([1, 0, 0], 0.1))).toBeCloseTo(0.1, 12);
    expect(length([q[0], q[1], q[2]]) ** 2 + q[3] ** 2).toBeCloseTo(1, 12);
  });

  it("turns the aimed point towards the camera", () => {
    for (const face of PLAY_FACES) {
      const basis = FACES[face];
      const point: Vec3 = [0, 1, 2].map(
        (axis) => basis.n[axis] * 0.5 + basis.u[axis] * 0.35 + basis.v[axis] * 0.35
      ) as Vec3;
      const aimed = quatRotate(tiltQuat(point), point);
      const before = point.reduce((sum, value, i) => sum + value * VIEW_DIR[i], 0) / length(point);
      const after = aimed.reduce((sum, value, i) => sum + value * VIEW_DIR[i], 0) / length(aimed);
      expect(after).toBeGreaterThan(before);
    }
  });

  it("keeps exactly the three play faces visible from every square centre", () => {
    for (const size of [2, 3, 4, 5, 6]) {
      const layout = buildLayout(size);
      for (let square = 0; square < layout.count; square++) {
        const point: Vec3 = [
          layout.center[square * 3],
          layout.center[square * 3 + 1],
          layout.center[square * 3 + 2]
        ];
        const q = tiltQuat(point);
        expect(visibleFaceCount(q)).toBe(3);
        const visible = visibleFaces(q);
        expect(visible).toHaveLength(3);
        expect(visible.every((face) => PLAY.has(face))).toBe(true);
        expect(tiltAngle(q)).toBeLessThanOrEqual(TILT_MAX + 1e-9);
      }
    }
  });

  it("keeps the play faces visible from every point on the face rims", () => {
    let worst = 0;
    for (const face of PLAY_FACES) {
      const basis = FACES[face];
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const u = -0.5 + i / 20;
          const v = -0.5 + j / 20;
          const point: Vec3 = [0, 1, 2].map(
            (axis) => basis.n[axis] * 0.5 + basis.u[axis] * u + basis.v[axis] * v
          ) as Vec3;
          const q = tiltQuat(point);
          expect(visibleFaceCount(q)).toBe(3);
          worst = Math.max(worst, tiltAngle(q));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(TILT_MAX + 1e-9);
  });
});

describe("visibleFaceCount", () => {
  it("counts the three camera-facing faces in the base orientation", () => {
    expect(visibleFaceCount(quatIdentity())).toBe(3);
  });

  it("keeps one face of each opposite pair for ordinary rotations", () => {
    expect(visibleFaceCount(quatFromAxis([1, 0, 0], Math.PI / 6))).toBe(3);
    expect(visibleFaceCount(quatFromAxis([1, 0, 0], Math.PI / 3))).toBe(3);
  });

  it("ignores exact grazing normals", () => {
    // A 45 degree turn about X leaves +Z exactly perpendicular to the view axis.
    const q = quatFromAxis([1, 0, 0], Math.PI / 4);
    expect(close(quatRotate(q, [0, 0, 1])[1], -Math.SQRT1_2)).toBe(true);
    expect(visibleFaceCount(q)).toBe(2);
  });
});
