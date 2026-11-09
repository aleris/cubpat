/** Procedural meshes for the cube: the rounded body, the rounded tiles that sit
 *  on its faces, and the stitch tubes that join path squares. Pure geometry in,
 *  PlayCanvas meshes out; no scene state lives here. */

import * as pc from "playcanvas";
import { cross, dot, madd, type Vec3 } from "../core/math.ts";

/** Tile corner radius, as a fraction of the tile edge. */
const TILE_CORNER = 0.22;
/** Segments per rounded tile corner. */
const TILE_CORNER_SEGMENTS = 6;
/** Radius of the rounded top edge, as a fraction of the tile thickness. */
const TILE_BEVEL = 0.55;
/** Segments across the rounded top edge. */
const TILE_BEVEL_SEGMENTS = 4;
/** Segments across each quarter of the body bevel. */
const BODY_BEVEL_SEGMENTS = 4;
/** Segments along a stitch (the half torus). */
const STITCH_ARC_SEGMENTS = 14;
/** Segments around the stitch thread. */
const STITCH_TUBE_SEGMENTS = 8;

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Push a quad centred on c spanning ±hx along ax (texture u) and ±hy along ay. */
export function pushQuad(
  m: MeshData, c: Vec3, ax: Vec3, ay: Vec3, hx: number, hy: number, n: Vec3,
  u0: number, u1: number, v0: number, v1: number
): void {
  const base = m.positions.length / 3;
  const corners: Array<[number, number, number, number]> = [
    [-1, -1, u0, v0],
    [1, -1, u1, v0],
    [1, 1, u1, v1],
    [-1, 1, u0, v1]
  ];
  for (const [sx, sy, u, v] of corners) {
    m.positions.push(
      c[0] + ax[0] * hx * sx + ay[0] * hy * sy,
      c[1] + ax[1] * hx * sx + ay[1] * hy * sy,
      c[2] + ax[2] * hx * sx + ay[2] * hy * sy
    );
    m.normals.push(n[0], n[1], n[2]);
    m.uvs.push(u, v);
  }
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Tile slab, `size` square by `thickness` deep, centred on the origin: a
 * rounded rectangle whose top edge is rounded over by a quarter circle. Built
 * at its real size (not scaled from a unit mesh) so the bevel stays circular.
 * The outline runs counter-clockwise seen from +Z.
 */
export function roundedTileMesh(device: pc.GraphicsDevice, size: number, thickness: number): pc.Mesh {
  const corner = TILE_CORNER * size;
  // insetting the outline by the bevel must leave a valid rounded rectangle
  const bevel = Math.min(TILE_BEVEL * thickness, corner);
  const c = size / 2 - corner;
  const top = thickness / 2;
  const outline: Array<[number, number, number, number]> = [];
  const centres: ReadonlyArray<readonly [number, number]> = [[c, c], [-c, c], [-c, -c], [c, -c]];
  centres.forEach(([cx, cy], k) => {
    for (let s = 0; s <= TILE_CORNER_SEGMENTS; s++) {
      const a = ((k + s / TILE_CORNER_SEGMENTS) * Math.PI) / 2;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      outline.push([cx + nx * corner, cy + ny * corner, nx, ny]);
    }
  });
  const count = outline.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Rings of the outline from the bottom edge up over the bevel: the bottom
  // ring, then the bevel profile from vertical (start of the arc, which also
  // tops the straight wall) to horizontal (edge of the top cap).
  const ring = (inset: number, z: number, nh: number, nz: number): number => {
    const base = positions.length / 3;
    for (const [x, y, nx, ny] of outline) {
      const px = x - nx * inset;
      const py = y - ny * inset;
      positions.push(px, py, z);
      normals.push(nx * nh, ny * nh, nz);
      // Planar map over the tile: the top cap samples the pattern once, and the
      // bevel and walls continue the same projection.
      uvs.push(px / size + 0.5, py / size + 0.5);
    }
    return base;
  };
  const rings = [ring(0, -top, 1, 0)];
  for (let s = 0; s <= TILE_BEVEL_SEGMENTS; s++) {
    const t = ((s / TILE_BEVEL_SEGMENTS) * Math.PI) / 2;
    rings.push(ring(bevel * (1 - Math.cos(t)), top - bevel + bevel * Math.sin(t), Math.cos(t), Math.sin(t)));
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    const lo = rings[r];
    const hi = rings[r + 1];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      indices.push(lo + i, lo + j, hi + j, lo + i, hi + j, hi + i);
    }
  }

  // top cap: fan over the last ring, whose normals already point up
  const topRing = rings[rings.length - 1];
  const topCentre = positions.length / 3;
  positions.push(0, 0, top);
  normals.push(0, 0, 1);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < count; i++) indices.push(topCentre, topRing + i, topRing + ((i + 1) % count));

  // bottom cap: own vertices, facing down
  const bottomRing = ring(0, -top, 0, -1);
  const bottomCentre = positions.length / 3;
  positions.push(0, 0, -top);
  normals.push(0, 0, -1);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < count; i++) indices.push(bottomCentre, bottomRing + ((i + 1) % count), bottomRing + i);

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Cube body, `half` from the origin to each face with every edge and corner
 * rounded over by `radius`: flat face quads, quarter-cylinder edges and sphere
 * octant corners. Together they close the box exactly, and the normals are
 * analytic everywhere so the bevel reads as one smooth surface. Every triangle
 * is wound to face along its vertex normals.
 */
function roundedCubeData(half: number, radius: number): MeshData {
  const flat = half - radius;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const vertex = (p: Vec3, n: Vec3): number => {
    const index = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    return index;
  };

  /** Triangle a-b-c, reversed when its winding fights the vertex normals. */
  const tri = (a: number, b: number, c: number): void => {
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];
    const gx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const gy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const gz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const ny = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (gx * nx + gy * ny + gz * nz < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  const quad = (a: number, b: number, c: number, d: number): void => {
    tri(a, b, c);
    tri(a, c, d);
  };

  // flat faces: the box plane inset by the bevel radius
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const n: Vec3 = [0, 0, 0];
    for (const sign of [1, -1]) {
      n[axis] = sign;
      const corner = (su: number, sv: number): number => {
        const p: Vec3 = [0, 0, 0];
        p[axis] = sign * half;
        p[u] = su * flat;
        p[v] = sv * flat;
        return vertex(p, n);
      };
      quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    }
  }

  // edges: quarter cylinders between the two adjacent flat faces
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    for (const si of [1, -1]) {
      for (const sj of [1, -1]) {
        const ring = (depth: number): number[] => {
          const ringIndices: number[] = [];
          for (let s = 0; s <= BODY_BEVEL_SEGMENTS; s++) {
            const t = ((s / BODY_BEVEL_SEGMENTS) * Math.PI) / 2;
            const n: Vec3 = [0, 0, 0];
            n[i] = si * Math.cos(t);
            n[j] = sj * Math.sin(t);
            const p: Vec3 = [0, 0, 0];
            p[i] = si * flat + n[i] * radius;
            p[j] = sj * flat + n[j] * radius;
            p[k] = depth;
            ringIndices.push(vertex(p, n));
          }
          return ringIndices;
        };
        const lo = ring(-flat);
        const hi = ring(flat);
        for (let s = 0; s < BODY_BEVEL_SEGMENTS; s++) quad(lo[s], lo[s + 1], hi[s + 1], hi[s]);
      }
    }
  }

  // corners: sphere octants, fanned from the point where they meet a face
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        const centre: Vec3 = [sx * flat, sy * flat, sz * flat];
        const pole = vertex([sx * half, sy * flat, sz * flat], [sx, 0, 0]);
        let inner: number[] = [];
        for (let r = 1; r <= BODY_BEVEL_SEGMENTS; r++) {
          const a = ((r / BODY_BEVEL_SEGMENTS) * Math.PI) / 2;
          const ring: number[] = [];
          for (let s = 0; s <= BODY_BEVEL_SEGMENTS; s++) {
            const b = ((s / BODY_BEVEL_SEGMENTS) * Math.PI) / 2;
            const n: Vec3 = [
              sx * Math.cos(a),
              sy * Math.sin(a) * Math.cos(b),
              sz * Math.sin(a) * Math.sin(b)
            ];
            ring.push(vertex(madd(centre, n, radius), n));
          }
          if (r === 1) {
            for (let s = 0; s < BODY_BEVEL_SEGMENTS; s++) tri(pole, ring[s], ring[s + 1]);
          } else {
            for (let s = 0; s < BODY_BEVEL_SEGMENTS; s++) quad(inner[s], inner[s + 1], ring[s + 1], ring[s]);
          }
          inner = ring;
        }
      }
    }
  }

  return { positions, normals, uvs: [], indices };
}

export function roundedCubeMesh(device: pc.GraphicsDevice, half: number, radius: number): pc.Mesh {
  const data = roundedCubeData(half, radius);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  mesh.setIndices(data.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Half a torus: the semicircular arc from `pA` to `pB` that rises along
 * `bulge`, swept as a tube of `radius`. The ends are open but buried in the
 * tiles, and the winding matches the outward tube normals.
 */
export function pushHalfTorus(m: MeshData, pA: Vec3, pB: Vec3, bulge: Vec3, radius: number): void {
  const chord = madd(pB, pA, -1);
  const len = Math.hypot(chord[0], chord[1], chord[2]);
  if (len < 1e-6) return;
  const e1: Vec3 = [chord[0] / len, chord[1] / len, chord[2] / len];
  const rise = madd(bulge, e1, -dot(bulge, e1));
  const riseLen = Math.hypot(rise[0], rise[1], rise[2]);
  if (riseLen < 1e-6) return;
  const e2: Vec3 = [rise[0] / riseLen, rise[1] / riseLen, rise[2] / riseLen];
  const axis = cross(e1, e2);
  const centre = madd(pA, chord, 0.5);
  const major = len / 2;

  const base = m.positions.length / 3;
  for (let i = 0; i <= STITCH_ARC_SEGMENTS; i++) {
    const theta = (i / STITCH_ARC_SEGMENTS) * Math.PI;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const radial: Vec3 = [e1[0] * ct + e2[0] * st, e1[1] * ct + e2[1] * st, e1[2] * ct + e2[2] * st];
    const ring = madd(centre, radial, major);
    for (let j = 0; j <= STITCH_TUBE_SEGMENTS; j++) {
      const phi = (j / STITCH_TUBE_SEGMENTS) * Math.PI * 2;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const nx = radial[0] * cp + axis[0] * sp;
      const ny = radial[1] * cp + axis[1] * sp;
      const nz = radial[2] * cp + axis[2] * sp;
      m.positions.push(ring[0] + nx * radius, ring[1] + ny * radius, ring[2] + nz * radius);
      m.normals.push(nx, ny, nz);
      m.uvs.push(i / STITCH_ARC_SEGMENTS, j / STITCH_TUBE_SEGMENTS);
    }
  }
  for (let i = 0; i < STITCH_ARC_SEGMENTS; i++) {
    for (let j = 0; j < STITCH_TUBE_SEGMENTS; j++) {
      const lo = base + i * (STITCH_TUBE_SEGMENTS + 1) + j;
      const hi = lo + STITCH_TUBE_SEGMENTS + 1;
      m.indices.push(lo, hi, hi + 1, lo, hi + 1, lo + 1);
    }
  }
}
