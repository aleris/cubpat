/**
 * Camera-relative view maths: the direction the game looks from, and the small
 * lean towards the square under the pointer. Engine independent.
 */

import { FACES, PLAY_FACES } from "./layout.ts";
import {
  clamp,
  dot,
  normalize,
  quatIdentity,
  quatMul,
  quatRotate,
  type Quat,
  type Vec3
} from "./math.ts";

/** Camera direction: (1,1,1) normalised, looking at the cube centre. */
export const VIEW_DIR: Vec3 = normalize([1, 1, 1]);

/**
 * How far the cube leans towards the point under the pointer, in radians.
 * This is the whole cursor affordance: leaning the touched part of the surface
 * towards the camera slides the surrounding squares under the pointer, so a
 * square is reached with less pointer travel. The cap keeps the three play
 * faces facing the camera (another face needs a rotation past ~35 degrees).
 */
export const TILT_MAX = (18 * Math.PI) / 180;

/**
 * Lean of the cube (local -> world) that points the given cube-local direction
 * as far towards the camera as possible, capped at `maxAngle`. Identity when
 * the point already lies on the camera axis.
 */
export function tiltQuat(point: Vec3, maxAngle: number = TILT_MAX): Quat {
  const len = Math.hypot(point[0], point[1], point[2]);
  if (len < 1e-6) return quatIdentity();
  const d: Vec3 = [point[0] / len, point[1] / len, point[2] / len];
  const facing = clamp(d[0] * VIEW_DIR[0] + d[1] * VIEW_DIR[1] + d[2] * VIEW_DIR[2], -1, 1);
  const angle = Math.acos(facing);
  if (angle < 1e-5) return quatIdentity();

  let axis: Vec3 = [
    d[1] * VIEW_DIR[2] - d[2] * VIEW_DIR[1],
    d[2] * VIEW_DIR[0] - d[0] * VIEW_DIR[2],
    d[0] * VIEW_DIR[1] - d[1] * VIEW_DIR[0]
  ];
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen < 1e-9) return quatIdentity();
  axis = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen];

  const half = Math.min(angle, maxAngle) * 0.5;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/**
 * Smallest dot a play face normal may make with the view direction while the
 * cube is turned by hand. Well above zero, so the face keeps enough of its area
 * to read instead of grazing the silhouette, and low enough that the lean on
 * its own (worst case 0.297) never reaches it.
 */
export const LOOK_MIN_FACING = 0.25;

/** Rotation of `angle` radians about `axis`, which need not be normalised. */
export function axisAngleQuat(axis: Vec3, angle: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-9 || angle === 0) return quatIdentity();
  const s = Math.sin(angle * 0.5) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle * 0.5)];
}

/**
 * True while every play face still faces the camera after the cube is rotated
 * by `q`. The hidden faces then stay hidden and no play face is lost, so the
 * play field and everything drawn on it stays readable.
 */
export function playFacesFacing(q: Quat): boolean {
  for (const face of PLAY_FACES) {
    const n = quatRotate(q, FACES[face].n);
    if (dot(n, VIEW_DIR) < LOOK_MIN_FACING) return false;
  }
  return true;
}

/**
 * Turn the cube from `from` about a camera-space `axis` by `angle` radians,
 * stopping at the largest shorter turn that keeps the play faces towards the
 * camera. A step that fits is applied whole, so a drag inside the limit tracks
 * the pointer exactly; one that would overshoot just stops at the limit.
 */
export function advanceLook(from: Quat, axis: Vec3, angle: number): Quat {
  if (angle === 0) return from;
  const full = quatMul(axisAngleQuat(axis, angle), from);
  if (playFacesFacing(full)) return full;
  let lo = 0;
  let hi = angle;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5;
    if (playFacesFacing(quatMul(axisAngleQuat(axis, mid), from))) lo = mid;
    else hi = mid;
  }
  return quatMul(axisAngleQuat(axis, lo), from);
}

/**
 * Screen travel of a finger, in CSS pixels, at which the lean of
 * `dragTilt` is full. About the reach a pointer hovering over the cube has,
 * so steering by dragging feels like steering by pointing.
 */
export const LEAN_REACH = 185;

/**
 * Lean of the cube (local -> world) for a drag of `dx`, `dy` CSS pixels from
 * where the finger started, with `right` and `up` the screen axes. The cube
 * tips the way the finger went, so the side face on that side comes round
 * towards the camera and the squares it hides come into reach. Travel is what
 * counts, not where the finger is: no travel is upright, so a press never
 * moves the cube, and the tip grows from there instead of jumping.
 */
export function dragTilt(dx: number, dy: number, right: Vec3, up: Vec3, reach = LEAN_REACH): Quat {
  if (dx === 0 && dy === 0) return quatIdentity();
  // Aim a point just off the camera axis by the travel, from the face the
  // camera already looks at: `tiltQuat` then tips the cube towards it and caps
  // the turn at `TILT_MAX`.
  return tiltQuat([
    VIEW_DIR[0] + (right[0] * dx - up[0] * dy) / reach,
    VIEW_DIR[1] + (right[1] * dx - up[1] * dy) / reach,
    VIEW_DIR[2] + (right[2] * dx - up[2] * dy) / reach
  ]);
}

/** Number of cube faces whose normal points towards the camera. The play field
 *  is only valid while this stays at three. */
export function visibleFaceCount(q: Quat): number {
  let count = 0;
  for (const basis of FACES) {
    const n = quatRotate(q, basis.n);
    if (n[0] * VIEW_DIR[0] + n[1] * VIEW_DIR[1] + n[2] * VIEW_DIR[2] > 1e-6) count++;
  }
  return count;
}
