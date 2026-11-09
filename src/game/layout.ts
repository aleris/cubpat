/**
 * Discrete cube surface geometry.
 *
 * The camera sits on the (1,1,1) diagonal, so exactly three faces face it:
 * front (+Z), right (+X) and top (+Y). Those three faces are the play field
 * (3·n² squares); the other three are never visible and never clickable.
 */

export type Vec3 = [number, number, number];

export interface FaceBasis {
  /** outward normal */
  n: Vec3;
  /** in-face axis of increasing column */
  u: Vec3;
  /** in-face axis of increasing row */
  v: Vec3;
}

/** Face ids. `face ^ 1` is always the opposite face. */
export const F_PX = 0;
export const F_NX = 1;
export const F_PY = 2;
export const F_NY = 3;
export const F_PZ = 4;
export const F_NZ = 5;

/** Each basis satisfies u x v = n (right handed / outward facing). */
export const FACES: readonly FaceBasis[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }
];

export const oppositeFace = (face: number): number => face ^ 1;

/** The three faces the camera sees, in preview order: front, right, top. */
export const PLAY_FACES: readonly [number, number, number] = [F_PZ, F_PX, F_PY];

/** How many faces are ever visible at once. */
export const FACES_PER_VIEW = 3;

const SLOT_OF_FACE = (() => {
  const map = new Int8Array(6).fill(-1);
  PLAY_FACES.forEach((face, slot) => {
    map[face] = slot;
  });
  return map;
})();

/** Play slot (0 front, 1 right, 2 top) of a face, or -1 when not in play. */
export function slotOfFace(face: number): number {
  return SLOT_OF_FACE[face];
}

/**
 * Neighbour direction ids, expressed in the owning square's face basis.
 * DIRS[d] is the unit vector (in the face basis) of the step.
 */
export const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];
export const DIR_U_PLUS = 0;
export const DIR_U_MINUS = 1;
export const DIR_V_PLUS = 2;
export const DIR_V_MINUS = 3;

export interface CubeLayout {
  size: number;
  /** squares in the play field (3·n²) */
  count: number;
  /** play face id (0..5) of each square */
  face: Uint8Array;
  /** play slot of each square: 0 front, 1 right, 2 top */
  slot: Uint8Array;
  row: Uint8Array;
  col: Uint8Array;
  /** 3 floats per square, cube local space */
  center: Float32Array;
  /** 4 neighbours per square, ordered like DIRS (-1 = outside the play field) */
  next: Int32Array;
}

export function squareIndex(size: number, slot: number, row: number, col: number): number {
  return slot * size * size + row * size + col;
}

/** Map an arbitrary point near the surface onto a play square, or -1 when the
 *  point belongs to one of the hidden faces. */
export function projectToSquare(size: number, x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x >= 0 ? F_PX : F_NX;
  else if (ay >= az) face = y >= 0 ? F_PY : F_NY;
  else face = z >= 0 ? F_PZ : F_NZ;

  const slot = SLOT_OF_FACE[face];
  if (slot < 0) return -1;

  const b = FACES[face];
  const uc = x * b.u[0] + y * b.u[1] + z * b.u[2];
  const vc = x * b.v[0] + y * b.v[1] + z * b.v[2];
  const n = size;
  const col = Math.min(n - 1, Math.max(0, Math.floor((uc + 0.5) * n)));
  const row = Math.min(n - 1, Math.max(0, Math.floor((vc + 0.5) * n)));
  return squareIndex(n, slot, row, col);
}

export function buildLayout(size: number): CubeLayout {
  const n = size;
  const count = FACES_PER_VIEW * n * n;
  const step = 1 / n;
  const face = new Uint8Array(count);
  const slot = new Uint8Array(count);
  const row = new Uint8Array(count);
  const col = new Uint8Array(count);
  const center = new Float32Array(count * 3);
  const next = new Int32Array(count * 4);

  for (let s = 0; s < FACES_PER_VIEW; s++) {
    const f = PLAY_FACES[s];
    const b = FACES[f];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = squareIndex(n, s, r, c);
        const uc = (c + 0.5) / n - 0.5;
        const vc = (r + 0.5) / n - 0.5;
        const cx = b.n[0] * 0.5 + b.u[0] * uc + b.v[0] * vc;
        const cy = b.n[1] * 0.5 + b.u[1] * uc + b.v[1] * vc;
        const cz = b.n[2] * 0.5 + b.u[2] * uc + b.v[2] * vc;
        face[i] = f;
        slot[i] = s;
        row[i] = r;
        col[i] = c;
        center[i * 3] = cx;
        center[i * 3 + 1] = cy;
        center[i * 3 + 2] = cz;

        for (let d = 0; d < 4; d++) {
          const [du, dv] = DIRS[d];
          const px = cx + (b.u[0] * du + b.v[0] * dv) * step;
          const py = cy + (b.u[1] * du + b.v[1] * dv) * step;
          const pz = cz + (b.u[2] * du + b.v[2] * dv) * step;
          next[i * 4 + d] = projectToSquare(n, px, py, pz);
        }
      }
    }
  }

  return { size: n, count, face, slot, row, col, center, next };
}

export function neighborCount(layout: CubeLayout, square: number): number {
  let count = 0;
  for (let d = 0; d < 4; d++) if (layout.next[square * 4 + d] >= 0) count++;
  return count;
}

export function areAdjacent(layout: CubeLayout, a: number, b: number): boolean {
  if (a < 0 || b < 0) return false;
  for (let d = 0; d < 4; d++) {
    if (layout.next[a * 4 + d] === b) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Quaternion helpers (plain tuples, so this module stays engine independent)
// ---------------------------------------------------------------------------

export type Quat = [number, number, number, number]; // x, y, z, w

export function quatIdentity(): Quat {
  return [0, 0, 0, 1];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}

/** Rotate `v` by `q`. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

// ---------------------------------------------------------------------------
// View: the camera direction and the small lean towards the active square
// ---------------------------------------------------------------------------

/** Camera direction: (1,1,1) normalised, looking at the cube centre. */
export const VIEW_DIR: Vec3 = (() => {
  const k = 1 / Math.sqrt(3);
  return [k, k, k];
})();

/**
 * How far the cube leans towards the point under the pointer, in radians.
 * This is the whole cursor affordance: leaning the touched part of the surface
 * towards the camera slides the surrounding squares under the pointer, so a
 * square is reached with less pointer travel. The cap keeps the three play
 * faces facing the camera (another face needs a rotation past ~35 degrees).
 */
export const TILT_MAX = (18 * Math.PI) / 180;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Lean of the cube (local -> world) that points the given cube-local direction
 * as far towards the camera as possible, capped at `maxAngle`. Identity when
 * the point already lies on the camera axis.
 */
export function tiltQuat(point: Vec3, maxAngle: number = TILT_MAX): Quat {
  const len = Math.hypot(point[0], point[1], point[2]);
  if (len < 1e-6) return quatIdentity();
  const d: Vec3 = [point[0] / len, point[1] / len, point[2] / len];
  const dot = clamp(d[0] * VIEW_DIR[0] + d[1] * VIEW_DIR[1] + d[2] * VIEW_DIR[2], -1, 1);
  const angle = Math.acos(dot);
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
