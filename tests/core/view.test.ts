import { describe, expect, it } from "vitest";
import { FACES, PLAY_FACES, buildLayout } from "../../src/core/layout.ts";
import { quatIdentity, quatMul, quatRotate, type Quat, type Vec3 } from "../../src/core/math.ts";
import {
  LOOK_MIN_FACING,
  TILT_MAX,
  VIEW_DIR,
  advanceLook,
  axisAngleQuat,
  dragTilt,
  playFacesFacing,
  tiltQuat,
  visibleFaceCount
} from "../../src/core/view.ts";

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

/** Same rotation, allowing the double cover (q and -q). */
function sameRotation(a: Quat, b: Quat): boolean {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return d > 1 - 1e-9;
}

/** Screen-right and screen-up, as the renderer derives them from the camera. */
const RIGHT: Vec3 = normalize([VIEW_DIR[2], 0, -VIEW_DIR[0]]);
const UP: Vec3 = [
  VIEW_DIR[1] * RIGHT[2] - VIEW_DIR[2] * RIGHT[1],
  VIEW_DIR[2] * RIGHT[0] - VIEW_DIR[0] * RIGHT[2],
  VIEW_DIR[0] * RIGHT[1] - VIEW_DIR[1] * RIGHT[0]
];

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

describe("axisAngleQuat", () => {
  it("matches a normalised axis and ignores a zero angle", () => {
    expect(sameRotation(axisAngleQuat([2, 0, 0], 0.4), quatFromAxis([1, 0, 0], 0.4))).toBe(true);
    expect(axisAngleQuat([1, 0, 0], 0)).toEqual(quatIdentity());
    expect(axisAngleQuat([0, 0, 0], 1)).toEqual(quatIdentity());
  });
});

describe("playFacesFacing", () => {
  it("accepts the base orientation and rejects one that swaps a play face out", () => {
    expect(playFacesFacing(quatIdentity())).toBe(true);
    // 40 degrees about the screen's up axis still shows three faces, but one of
    // them is the hidden -X face: the play field has turned out of view.
    const q = quatFromAxis(UP, (40 * Math.PI) / 180);
    expect(visibleFaceCount(q)).toBe(3);
    expect(visibleFaces(q).every((face) => PLAY.has(face))).toBe(false);
    expect(playFacesFacing(q)).toBe(false);
  });

  it("keeps the play faces inside the facing limit it documents", () => {
    const q = quatFromAxis(UP, (20 * Math.PI) / 180);
    expect(playFacesFacing(q)).toBe(true);
    for (const face of PLAY_FACES) {
      const n = quatRotate(q, FACES[face].n);
      expect(n[0] * VIEW_DIR[0] + n[1] * VIEW_DIR[1] + n[2] * VIEW_DIR[2]).toBeGreaterThan(
        LOOK_MIN_FACING
      );
    }
  });
});

describe("advanceLook", () => {
  it("applies a turn that fits to the whole orientation", () => {
    const from = quatFromAxis(RIGHT, 0.05);
    expect(sameRotation(advanceLook(from, UP, 0.2), quatMul(quatFromAxis(UP, 0.2), from))).toBe(
      true
    );
  });

  it("leaves the orientation alone for a zero-angle move", () => {
    const from = quatFromAxis(RIGHT, 0.3);
    expect(advanceLook(from, UP, 0)).toEqual(from);
  });

  it("stops at the largest turn that keeps the play faces in view", () => {
    const turned = advanceLook(quatIdentity(), UP, 1);
    expect(playFacesFacing(turned)).toBe(true);
    expect(visibleFaceCount(turned)).toBe(3);
    expect(visibleFaces(turned).every((face) => PLAY.has(face))).toBe(true);
    // About 23 degrees: any further and +X would tip out of the view.
    expect(tiltAngle(turned)).toBeCloseTo(0.407, 2);
    // Held at the limit it stays put (to within the facing margin) and it
    // still turns back.
    const pushed = advanceLook(turned, UP, 0.2);
    expect(playFacesFacing(pushed)).toBe(true);
    expect(tiltAngle(pushed)).toBeCloseTo(tiltAngle(turned), 3);
    expect(sameRotation(advanceLook(turned, UP, -0.05), turned)).toBe(false);
  });

  it("keeps the play faces in view through a long two-axis drag", () => {
    let q = quatIdentity();
    const steps = [
      [18, 0],
      [18, 9],
      [0, 18],
      [-24, 0],
      [0, -30],
      [-30, -30],
      [45, 45],
      [-60, 40]
    ];
    for (const [dx, dy] of steps) {
      q = advanceLook(q, UP, dx * 0.02);
      q = advanceLook(q, RIGHT, dy * 0.02);
      expect(playFacesFacing(q)).toBe(true);
      expect(visibleFaces(q).every((face) => PLAY.has(face))).toBe(true);
    }
  });
});

describe("dragTilt", () => {
  /** The face on the camera's right: the one a drag to the right exposes. */
  const dotOf = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rightFace = FACES.reduce(
    (best, face, index) => (dotOf(face.n, RIGHT) > dotOf(FACES[best].n, RIGHT) ? index : best),
    0
  );
  const facing = (q: Quat): number => dotOf(quatRotate(q, FACES[rightFace].n), VIEW_DIR);

  it("is upright until the finger travels", () => {
    expect(sameRotation(dragTilt(0, 0, RIGHT, UP), quatIdentity())).toBe(true);
  });

  it("tips a little for a small move and grows with the travel", () => {
    const nudge = tiltAngle(dragTilt(6, 0, RIGHT, UP));
    const pull = tiltAngle(dragTilt(60, 0, RIGHT, UP));

    expect(nudge).toBeGreaterThan(0.02);
    expect(nudge).toBeLessThan(0.1);
    expect(pull).toBeGreaterThan(nudge);
    expect(tiltAngle(dragTilt(16, 0, RIGHT, UP))).toBeGreaterThan(nudge);
  });

  it("stops at the tilt limit however far the finger goes", () => {
    expect(tiltAngle(dragTilt(400, 0, RIGHT, UP))).toBeCloseTo(TILT_MAX, 9);
    expect(tiltAngle(dragTilt(-400, 0, RIGHT, UP))).toBeCloseTo(TILT_MAX, 9);
    expect(tiltAngle(dragTilt(0, 400, RIGHT, UP))).toBeCloseTo(TILT_MAX, 9);
  });

  it("brings the face on the side the finger went towards the camera", () => {
    expect(facing(dragTilt(60, 0, RIGHT, UP))).toBeGreaterThan(facing(quatIdentity()));
    expect(facing(dragTilt(-60, 0, RIGHT, UP))).toBeLessThan(facing(quatIdentity()));
  });

  it("keeps the play faces in view at the limit", () => {
    for (const [dx, dy] of [[400, 0], [-400, 0], [0, 400], [0, -400], [300, 300], [-300, 300]]) {
      expect(playFacesFacing(dragTilt(dx, dy, RIGHT, UP))).toBe(true);
    }
  });
});
