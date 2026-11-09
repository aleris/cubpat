/**
 * Camera-relative view maths: the direction the game looks from, and the small
 * lean towards the square under the pointer. Engine independent.
 */

import { FACES } from "./layout.ts";
import { clamp, normalize, quatIdentity, quatRotate, type Quat, type Vec3 } from "./math.ts";

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
