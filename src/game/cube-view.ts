import * as pc from "playcanvas";
import {
  FACES,
  TILT_MAX,
  projectToSquare,
  tiltQuat
} from "./layout.ts";
import type { CubeLayout } from "./layout.ts";
import type { Level } from "./levels.ts";

/** Rotation (Euler, degrees) that turns a box's local +Z into each face normal. */
const FACE_EULER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 90, 0],
  [0, -90, 0],
  [-90, 0, 0],
  [90, 0, 0],
  [0, 0, 0],
  [0, 180, 0]
];

const TILE_INSET = 0.12;
const TILE_THICKNESS = 0.03;
/** Tile corner radius, as a fraction of the tile edge. */
const TILE_CORNER = 0.22;
/** Segments per rounded tile corner. */
const TILE_CORNER_SEGMENTS = 6;
/** Radius of the rounded top edge, as a fraction of the tile thickness. */
const TILE_BEVEL = 0.55;
/** Segments across the rounded top edge. */
const TILE_BEVEL_SEGMENTS = 4;
const TILE_OFFSET = 0.5 + 0.006;

/**
 * Radius of the cube body's edge bevel (world units). Small enough to hide
 * under the squares: the nearest square edge is at most 0.06/size from a face
 * edge (0.01 at size 6) and tiles sink 0.009 into the body, so the bevel never
 * leaves a gap beneath a tile.
 */
const BODY_BEVEL = 0.02;
/** Segments across each quarter of the body bevel. */
const BODY_BEVEL_SEGMENTS = 4;
const PICK_HALF = 0.5 + TILE_THICKNESS;
/** Time constant of the lean as it follows the pointer, in seconds. */
const TILT_FOLLOW = 0.08;

const GLOW_RISE = 0.08;
const GLOW_SETTLE = 0.3;
const GLOW_SUSTAIN = 0.4;
const GLOW_HOLD = 0.25;
const GLOW_FADE = 0.35;

/** Lift of the dashed path line above the cube surface (clears tiles and glow). */
const PATH_LIFT = 0.026;
/** Lift of the start/stop icons above the cube surface (above the dashes). */
const ICON_LIFT = 0.029;
/** Dash width, as a fraction of the square size. */
const DASH_WIDTH = 0.08;
/** Dash length, as a fraction of the square size. */
const DASH_LENGTH = 0.18;
/** Gap between dashes, as a fraction of the square size. */
const DASH_GAP = 0.13;
/** Start/stop icon edge length, as a fraction of the square size. */
const ICON_SIZE = 0.62;

type Vec = [number, number, number];

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** a + b * k */
function madd(a: Vec, b: Vec, k: number): Vec {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Push a quad centred on c spanning ±hx along ax (texture u) and ±hy along ay. */
function pushQuad(
  m: MeshData, c: Vec, ax: Vec, ay: Vec, hx: number, hy: number, n: Vec,
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
function roundedTileMesh(device: pc.GraphicsDevice, size: number, thickness: number): pc.Mesh {
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
  const indices: number[] = [];

  // Rings of the outline from the bottom edge up over the bevel: the bottom
  // ring, then the bevel profile from vertical (start of the arc, which also
  // tops the straight wall) to horizontal (edge of the top cap).
  const ring = (inset: number, z: number, nh: number, nz: number): number => {
    const base = positions.length / 3;
    for (const [x, y, nx, ny] of outline) {
      positions.push(x - nx * inset, y - ny * inset, z);
      normals.push(nx * nh, ny * nh, nz);
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
  for (let i = 0; i < count; i++) indices.push(topCentre, topRing + i, topRing + ((i + 1) % count));

  // bottom cap: own vertices, facing down
  const bottomRing = ring(0, -top, 0, -1);
  const bottomCentre = positions.length / 3;
  positions.push(0, 0, -top);
  normals.push(0, 0, -1);
  for (let i = 0; i < count; i++) indices.push(bottomCentre, bottomRing + ((i + 1) % count), bottomRing + i);

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
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

  const vertex = (p: Vec, n: Vec): number => {
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
    const n: Vec = [0, 0, 0];
    for (const sign of [1, -1]) {
      n[axis] = sign;
      const corner = (su: number, sv: number): number => {
        const p: Vec = [0, 0, 0];
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
            const n: Vec = [0, 0, 0];
            n[i] = si * Math.cos(t);
            n[j] = sj * Math.sin(t);
            const p: Vec = [0, 0, 0];
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
        const centre: Vec = [sx * flat, sy * flat, sz * flat];
        const pole = vertex([sx * half, sy * flat, sz * flat], [sx, 0, 0]);
        let inner: number[] = [];
        for (let r = 1; r <= BODY_BEVEL_SEGMENTS; r++) {
          const a = ((r / BODY_BEVEL_SEGMENTS) * Math.PI) / 2;
          const ring: number[] = [];
          for (let s = 0; s <= BODY_BEVEL_SEGMENTS; s++) {
            const b = ((s / BODY_BEVEL_SEGMENTS) * Math.PI) / 2;
            const n: Vec = [
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

function roundedCubeMesh(device: pc.GraphicsDevice, half: number, radius: number): pc.Mesh {
  const data = roundedCubeData(half, radius);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  mesh.setIndices(data.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** Atlas: left cell = start (play triangle), right cell = stop (rounded square). */
function drawIconAtlas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 128);
  for (const cx of [64, 192]) {
    ctx.fillStyle = "rgba(12,14,24,0.8)";
    ctx.beginPath();
    ctx.arc(cx, 64, 58, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  // play triangle, ~58px tall overall (incl. rounded stroke), optically centred
  const h = 50;
  const w = h * 0.87;
  const ox = 64 + 5 - w / 2;
  ctx.beginPath();
  ctx.moveTo(ox, 64 - h / 2);
  ctx.lineTo(ox + w, 64);
  ctx.lineTo(ox, 64 + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // rounded square, ~46px
  const q = 38;
  ctx.beginPath();
  ctx.rect(192 - q / 2, 64 - q / 2, q, q);
  ctx.fill();
  ctx.stroke();
  return canvas;
}

interface Segment {
  p0: Vec;
  dir: Vec;
  n: Vec;
  face: number;
  start: number;
  len: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface GlowState {
  path: number[];
  overlays: pc.Entity[];
  materials: pc.StandardMaterial[];
  step: number;
  holdStart: number;
  time: number;
  onDone: (() => void) | null;
}

export class CubeRenderer {
  readonly root: pc.Entity;
  readonly layout: CubeLayout;
  readonly level: Level;

  private readonly camera: pc.Entity;
  private readonly canvas: HTMLCanvasElement;
  private readonly tiles: pc.Entity[] = [];
  private readonly tileMesh: pc.Mesh;

  private readonly emptyMaterial: pc.StandardMaterial;
  private readonly emptyHoverMaterial: pc.StandardMaterial;
  private readonly colorMaterials: pc.StandardMaterial[] = [];
  private readonly hoverMaterials: pc.StandardMaterial[] = [];
  private readonly bodyMaterial: pc.StandardMaterial;
  private readonly device: pc.GraphicsDevice;
  private readonly pathMarks: pc.Entity;
  private readonly iconMarks: pc.Entity;
  private readonly dashMaterial: pc.StandardMaterial;
  private readonly iconMaterial: pc.StandardMaterial;
  private readonly iconTexture: pc.Texture;

  private owners: Int8Array;
  private paths: readonly number[][] = [];
  private hover = -1;
  private head = -1;
  private time = 0;

  /** Lean the cube follows: the surface under the pointer, turned to the camera. */
  private readonly tiltTarget = new pc.Quat();
  private readonly tiltTmp = new pc.Quat();
  private readonly focusPoint: Vec = [0, 0, 0];

  private glow: GlowState | null = null;
  private readonly tileGlow: Float32Array;

  private readonly tmpA = new pc.Vec3();
  private readonly tmpB = new pc.Vec3();
  private readonly tmpC = new pc.Vec3();
  private readonly tmpD = new pc.Vec3();
  private readonly tmpE = new pc.Vec3();
  private readonly tmpMat = new pc.Mat4();

  constructor(app: pc.AppBase, camera: pc.Entity, level: Level) {
    this.camera = camera;
    this.level = level;
    this.layout = level.layout;
    this.canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    this.owners = new Int8Array(level.layout.count).fill(-1);
    this.owners.set(level.initial);
    this.tileGlow = new Float32Array(level.layout.count);

    this.emptyMaterial = this.makeMaterial("#313748", "#000000", 0);
    this.emptyHoverMaterial = this.makeMaterial("#525a72", "#12151f", 0);
    for (let i = 0; i < level.palette.length; i++) {
      const hex = level.palette[i];
      this.colorMaterials.push(this.makeMaterial(hex, hex, 0.07));
      this.hoverMaterials.push(this.makeMaterial(hex, "#ffffff", 0.2, true));
    }

    this.root = new pc.Entity("cube-root");
    app.root.addChild(this.root);
    this.root.setLocalRotation(new pc.Quat());

    // The body is the visible surface beneath the squares: one closed box with
    // bevelled edges and corners, so the faces meet without a seam and the
    // silhouette catches a highlight instead of a razor edge.
    this.device = app.graphicsDevice;
    this.bodyMaterial = this.makeMaterial("#1c2130", "#1c2130", 0.04);
    const body = new pc.Entity("cube-body");
    body.addComponent("render");
    body.render!.meshInstances = [
      new pc.MeshInstance(roundedCubeMesh(this.device, 0.5, BODY_BEVEL), this.bodyMaterial)
    ];
    this.root.addChild(body);
    this.tileMesh = roundedTileMesh(this.device, (1 / level.size) * (1 - TILE_INSET), TILE_THICKNESS);
    for (let i = 0; i < level.layout.count; i++) this.createTile(i);
    this.applyMaterials();

    this.dashMaterial = new pc.StandardMaterial();
    this.dashMaterial.useLighting = false;
    this.dashMaterial.diffuse = new pc.Color(0, 0, 0);
    this.dashMaterial.emissive = new pc.Color().fromString("#f4f6ff");
    this.dashMaterial.cull = pc.CULLFACE_NONE;
    this.dashMaterial.update();

    this.iconTexture = new pc.Texture(this.device, {
      width: 256,
      height: 128,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE
    });
    this.iconTexture.setSource(drawIconAtlas());
    this.iconMaterial = new pc.StandardMaterial();
    this.iconMaterial.useLighting = false;
    this.iconMaterial.diffuse = new pc.Color(0, 0, 0);
    this.iconMaterial.emissive = new pc.Color(1, 1, 1);
    this.iconMaterial.emissiveMap = this.iconTexture;
    this.iconMaterial.opacityMap = this.iconTexture;
    this.iconMaterial.opacityMapChannel = "a";
    this.iconMaterial.blendType = pc.BLEND_NORMAL;
    this.iconMaterial.depthWrite = false;
    this.iconMaterial.cull = pc.CULLFACE_NONE;
    this.iconMaterial.update();

    this.pathMarks = new pc.Entity("path-marks");
    this.pathMarks.addComponent("render");
    this.root.addChild(this.pathMarks);
    this.iconMarks = new pc.Entity("icon-marks");
    this.iconMarks.addComponent("render");
    this.root.addChild(this.iconMarks);
    this.rebuildMarkers();
  }

  // -------------------------------------------------------------------------
  // construction helpers
  // -------------------------------------------------------------------------

  private makeMaterial(hex: string, emissiveHex: string, emissiveScale: number, lighten = false): pc.StandardMaterial {
    const mat = new pc.StandardMaterial();
    const diffuse = new pc.Color().fromString(hex);
    if (lighten) diffuse.lerp(diffuse, new pc.Color(1, 1, 1), 0.13);
    const emissive = new pc.Color().fromString(emissiveHex);
    mat.diffuse = diffuse;
    mat.emissive = new pc.Color(
      emissive.r * emissiveScale,
      emissive.g * emissiveScale,
      emissive.b * emissiveScale
    );
    mat.specular = new pc.Color(0.16, 0.16, 0.18);
    mat.useMetalness = false;
    mat.gloss = 0.55;
    mat.update();
    return mat;
  }

  private createTile(index: number): void {
    const face = this.layout.face[index];
    const basis = FACES[face];
    const entity = new pc.Entity(`tile-${index}`);
    entity.addComponent("render");
    entity.render!.meshInstances = [new pc.MeshInstance(this.tileMesh, this.emptyMaterial)];
    entity.setLocalPosition(
      this.layout.center[index * 3] + basis.n[0] * (TILE_OFFSET - 0.5),
      this.layout.center[index * 3 + 1] + basis.n[1] * (TILE_OFFSET - 0.5),
      this.layout.center[index * 3 + 2] + basis.n[2] * (TILE_OFFSET - 0.5)
    );
    const euler = FACE_EULER[face];
    entity.setLocalEulerAngles(euler[0], euler[1], euler[2]);
    this.root.addChild(entity);
    this.tiles.push(entity);
  }

  // -------------------------------------------------------------------------
  // state
  // -------------------------------------------------------------------------

  get count(): number {
    return this.layout.count;
  }

  setBoard(owners: Int8Array, paths: readonly number[][]): void {
    this.owners = owners;
    this.paths = paths;
    this.applyMaterials();
    this.rebuildMarkers();
  }

  setHover(index: number): void {
    if (this.hover === index) return;
    this.hover = index;
    this.applyMaterials();
  }

  setHead(index: number): void {
    if (this.head === index) return;
    this.head = index;
    this.applyMaterials();
  }

  private applyMaterials(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const color = this.owners[i];
      const highlighted = i === this.hover || i === this.head;
      let material: pc.Material;
      if (color < 0) material = highlighted ? this.emptyHoverMaterial : this.emptyMaterial;
      else material = highlighted ? this.hoverMaterials[color] : this.colorMaterials[color];
      const instance = this.tiles[i].render!.meshInstances[0];
      if (instance.material !== material) instance.material = material;
    }
  }

  // -------------------------------------------------------------------------
  // path markers: start/stop icons and a dashed line through the path
  // -------------------------------------------------------------------------

  private centreOf(square: number): Vec {
    const c = this.layout.center;
    return [c[square * 3], c[square * 3 + 1], c[square * 3 + 2]];
  }

  private rebuildMarkers(): void {
    const s = 1 / this.level.size;
    const dashes: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
    const icons: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
    const half = (ICON_SIZE * s) / 2;
    // Icons lie flat on their square, aligned with the tile grid. Of the four
    // grid directions, the glyph's +u takes the one closest to screen right
    // (rest pose, so a mid-tilt rebuild picks the same one), so ▶ reads as
    // "play" on every face. Canvas rows run downwards, hence v from 1 at the
    // bottom edge to 0 at the top.
    const right = this.camera.right;
    const camR: Vec = [right.x, right.y, right.z];

    for (let c = 0; c < this.paths.length; c++) {
      const path = this.paths[c];
      if (!path || path.length === 0) continue;
      const start = path[0];
      const [ea, eb] = this.level.endpoints[c];
      const stop = start === ea ? eb : ea;

      for (const [square, u0] of [[start, 0], [stop, 0.5]] as const) {
        const basis = FACES[this.layout.face[square]];
        const n = basis.n as Vec;
        let ax = basis.u as Vec;
        for (const axis of [basis.u, basis.v] as Vec[]) {
          for (const sign of [1, -1]) {
            const k = dot(axis, camR) * sign;
            if (k > dot(ax, camR)) ax = [axis[0] * sign, axis[1] * sign, axis[2] * sign];
          }
        }
        pushQuad(icons, madd(this.centreOf(square), n, ICON_LIFT), ax, cross(n, ax), half, half, n, u0, u0 + 0.5, 1, 0);
      }

      if (path.length >= 2) {
        const trimEnd = path[path.length - 1] === stop ? ICON_SIZE * s * 0.45 : 0;
        this.pushDashes(dashes, path, s, ICON_SIZE * s * 0.45, trimEnd);
      }
    }

    this.setMarkerMesh(this.pathMarks, dashes, this.dashMaterial);
    this.setMarkerMesh(this.iconMarks, icons, this.iconMaterial);
  }

  private pushDashes(m: MeshData, path: readonly number[], s: number, trimStart: number, trimEnd: number): void {
    // polyline on the raised cube surface; every segment keeps its face normal
    const segments: Segment[] = [];
    let total = 0;
    const addSegment = (p0: Vec, p1: Vec, face: number): void => {
      const d = madd(p1, p0, -1);
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-9) return;
      segments.push({
        p0,
        dir: [d[0] / len, d[1] / len, d[2] / len],
        n: FACES[face].n as Vec,
        face,
        start: total,
        len
      });
      total += len;
    };
    for (let k = 0; k + 1 < path.length; k++) {
      const fa = this.layout.face[path[k]];
      const fb = this.layout.face[path[k + 1]];
      const nA = FACES[fa].n as Vec;
      const nB = FACES[fb].n as Vec;
      const A = this.centreOf(path[k]);
      const B = this.centreOf(path[k + 1]);
      if (fa === fb) {
        addSegment(madd(A, nA, PATH_LIFT), madd(B, nA, PATH_LIFT), fa);
      } else {
        const E = madd(A, nB, 0.5 - dot(A, nB));
        const E2 = madd(madd(E, nA, PATH_LIFT), nB, PATH_LIFT);
        addSegment(madd(A, nA, PATH_LIFT), E2, fa);
        addSegment(E2, madd(B, nB, PATH_LIFT), fb);
      }
    }

    const end = total - trimEnd;
    const period = (DASH_LENGTH + DASH_GAP) * s;
    const width = DASH_WIDTH * s;
    for (let d0 = trimStart; d0 < end; d0 += period) {
      const d1 = Math.min(end, d0 + DASH_LENGTH * s);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const lo = Math.max(d0, seg.start);
        const hi = Math.min(d1, seg.start + seg.len);
        if (hi <= lo) continue;
        let a = lo - seg.start;
        let b = hi - seg.start;
        // fill corners at turns within a face; cube-edge joints meet exactly
        if (lo > d0 && i > 0 && segments[i - 1].face === seg.face) a -= width / 2;
        if (hi < d1 && i + 1 < segments.length && segments[i + 1].face === seg.face) b += width / 2;
        const centre = madd(seg.p0, seg.dir, (a + b) / 2);
        pushQuad(m, centre, seg.dir, cross(seg.n, seg.dir), (b - a) / 2, width / 2, seg.n, 0, 0, 0, 0);
      }
    }
  }

  private setMarkerMesh(entity: pc.Entity, data: MeshData, material: pc.Material): void {
    const render = entity.render!;
    if (data.indices.length === 0) {
      render.meshInstances = [];
      entity.enabled = false;
      return;
    }
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(data.positions);
    mesh.setNormals(data.normals);
    mesh.setUvs(0, data.uvs);
    mesh.setIndices(data.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    render.meshInstances = [new pc.MeshInstance(mesh, material)];
    entity.enabled = true;
  }

  // -------------------------------------------------------------------------
  // orientation: the cube leans towards the pointer
  // -------------------------------------------------------------------------

  /**
   * Follow the pointer. The cube leans the spot under the pointer towards the
   * camera, so that spot's square is the most frontal part of the view and the
   * squares around it slide towards the pointer. Leaning is continuous: every
   * pointer move re-aims it, whether or not the square under the pointer
   * changes, which is what makes crossing to a neighbour cost less travel.
   */
  setCursor(clientX: number, clientY: number): void {
    // Rest frame: the root only rotates about the origin, so world space is
    // also the untransformed cube space. Deliberately not the leaned frame:
    // the aim must be a function of the pointer alone or it feeds back on itself.
    if (!this.screenRay(clientX, clientY) || !this.hitCube(this.tmpA, this.tmpB, this.tmpC)) {
      this.clearCursor();
      return;
    }
    this.focusPoint[0] = this.tmpC.x;
    this.focusPoint[1] = this.tmpC.y;
    this.focusPoint[2] = this.tmpC.z;
    const q = tiltQuat(this.focusPoint, TILT_MAX);
    this.tiltTarget.set(q[0], q[1], q[2], q[3]);
  }

  /** Rest the cube upright (pointer off the cube, or a touch lifted). */
  clearCursor(): void {
    this.tiltTarget.set(0, 0, 0, 1);
  }

  private updateTilt(dt: number): void {
    const target = this.tiltTarget;
    const current = this.root.getLocalRotation();
    const dot = Math.abs(
      current.x * target.x + current.y * target.y + current.z * target.z + current.w * target.w
    );
    // Settled to within ~1e-3 degrees: stop touching the entity.
    if (dot > 0.999999999) return;
    this.tiltTmp.slerp(current, target, 1 - Math.exp(-dt / TILT_FOLLOW));
    this.root.setLocalRotation(this.tiltTmp);
  }

  // -------------------------------------------------------------------------
  // picking
  // -------------------------------------------------------------------------

  /**
   * World-space ray through a client point: `tmpA` becomes the near clip point
   * and `tmpB` the unit direction. False when the canvas has no area.
   */
  private screenRay(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const px = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((clientY - rect.top) / rect.height) * this.canvas.height;
    const cam = this.camera.camera!;
    cam.screenToWorld(px, py, cam.nearClip, this.tmpA);
    cam.screenToWorld(px, py, cam.farClip, this.tmpB);
    this.tmpB.sub(this.tmpA).normalize();
    return true;
  }

  /**
   * Entry point of a ray into the pick cube, in whatever frame the ray is
   * already expressed in. Writes the hit to `out`.
   */
  private hitCube(origin: pc.Vec3, dir: pc.Vec3, out: pc.Vec3): boolean {
    let tmin = -Infinity;
    let tmax = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
      const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
      if (Math.abs(d) < 1e-9) {
        if (Math.abs(o) > PICK_HALF) return false;
        continue;
      }
      let t1 = (-PICK_HALF - o) / d;
      let t2 = (PICK_HALF - o) / d;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    if (tmin < 0 || tmax < 0) return false;
    out.copy(dir).scale(tmin).add(origin);
    return true;
  }

  pick(clientX: number, clientY: number): number | null {
    if (!this.screenRay(clientX, clientY)) return null;
    this.tmpMat.copy(this.root.getWorldTransform()).invert();
    const origin = this.tmpMat.transformPoint(this.tmpA, this.tmpC);
    const dir = this.tmpMat.transformVector(this.tmpB, this.tmpD).normalize();
    if (!this.hitCube(origin, dir, this.tmpE)) return null;
    return projectToSquare(this.layout.size, this.tmpE.x, this.tmpE.y, this.tmpE.z);
  }

  // -------------------------------------------------------------------------
  // completion glow: the path's squares light up one by one
  // -------------------------------------------------------------------------

  playPathGlow(color: number, path: number[], onDone?: () => void): void {
    this.clearGlow();
    if (path.length === 0) {
      onDone?.();
      return;
    }
    const hex = this.level.palette[color % this.level.palette.length];
    const overlays: pc.Entity[] = [];
    const materials: pc.StandardMaterial[] = [];
    for (const square of path) {
      const mat = new pc.StandardMaterial();
      mat.diffuse = new pc.Color(0, 0, 0);
      mat.specular = new pc.Color(0, 0, 0);
      mat.emissive = new pc.Color().fromString(hex);
      mat.emissiveIntensity = 0;
      mat.blendType = pc.BLEND_ADDITIVE;
      mat.depthWrite = false;
      mat.update();
      const overlay = new pc.Entity("path-glow");
      overlay.addComponent("render");
      overlay.render!.meshInstances = [new pc.MeshInstance(this.tileMesh, mat)];
      overlay.setLocalScale(1, 1, 0.1);
      overlay.setLocalPosition(0, 0, TILE_THICKNESS * (0.5 + 0.05 + 0.02));
      overlay.enabled = false;
      this.tiles[square].addChild(overlay);
      overlays.push(overlay);
      materials.push(mat);
    }

    const span = Math.min(1.3, 0.45 + path.length * 0.045);
    const step = span / path.length;
    this.glow = {
      path: path.slice(),
      overlays,
      materials,
      step,
      holdStart: (path.length - 1) * step + GLOW_HOLD,
      time: 0,
      onDone: onDone ?? null
    };
  }

  stopGlow(): void {
    this.clearGlow();
  }

  private clearGlow(): void {
    if (this.glow) {
      for (const overlay of this.glow.overlays) overlay.destroy();
      for (const mat of this.glow.materials) mat.destroy();
      this.glow = null;
    }
    this.tileGlow.fill(0);
  }

  private updateGlow(dt: number): void {
    const glow = this.glow;
    if (!glow) return;
    glow.time += dt;
    const fadeT = Math.max(0, (glow.time - glow.holdStart) / GLOW_FADE);
    const fade = 1 - Math.min(1, fadeT);
    for (let k = 0; k < glow.path.length; k++) {
      const a = glow.time - k * glow.step;
      let level = 0;
      let flash = 0;
      if (a >= 0) {
        if (a < GLOW_RISE) {
          level = flash = a / GLOW_RISE;
        } else {
          const e = easeInOutCubic(Math.min(1, (a - GLOW_RISE) / GLOW_SETTLE));
          level = 1 - (1 - GLOW_SUSTAIN) * e;
          flash = 1 - e;
        }
      }
      level *= fade;
      this.tileGlow[glow.path[k]] = flash * fade;
      const overlay = glow.overlays[k];
      if (level <= 0.001) {
        overlay.enabled = false;
      } else {
        overlay.enabled = true;
        const mat = glow.materials[k];
        mat.emissiveIntensity = level;
        mat.update();
      }
    }
    if (fadeT >= 1) {
      const done = glow.onDone;
      this.clearGlow();
      done?.();
    }
  }

  // -------------------------------------------------------------------------
  // frame
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    this.updateTilt(dt);

    this.updateGlow(dt);

    const breathe = 1 + Math.sin(this.time * 3.4) * 0.022;
    for (let i = 0; i < this.tiles.length; i++) {
      let scale = 1;
      if (i === this.hover) scale = 1.055;
      else if (i === this.head) scale = 1.04 * breathe;
      scale = Math.max(scale, 1 + 0.08 * this.tileGlow[i]);
      this.tiles[i].setLocalScale(scale, scale, 1);
    }
  }

  destroy(): void {
    this.clearGlow();
    this.root.destroy();
    this.emptyMaterial.destroy();
    this.emptyHoverMaterial.destroy();
    for (const mat of this.colorMaterials) mat.destroy();
    for (const mat of this.hoverMaterials) mat.destroy();
    this.bodyMaterial.destroy();
    this.dashMaterial.destroy();
    this.iconMaterial.destroy();
    this.iconTexture.destroy();
  }
}
