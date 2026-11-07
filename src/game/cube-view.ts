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
const TILE_OFFSET = 0.5 + 0.006;
const PICK_HALF = 0.5 + TILE_THICKNESS;
const TILT_DURATION = 0.24;

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
  private readonly tileScale: number;

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

  private readonly tiltFrom = new pc.Quat();
  private readonly tiltTarget = new pc.Quat();
  private readonly tiltTmp = new pc.Quat();
  private tiltT = 1;
  private tilting = false;

  private glow: GlowState | null = null;
  private readonly tileGlow: Float32Array;

  private readonly tmpA = new pc.Vec3();
  private readonly tmpB = new pc.Vec3();
  private readonly tmpC = new pc.Vec3();
  private readonly tmpD = new pc.Vec3();
  private readonly tmpMat = new pc.Mat4();

  constructor(app: pc.AppBase, camera: pc.Entity, level: Level) {
    this.camera = camera;
    this.level = level;
    this.layout = level.layout;
    this.canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    this.owners = new Int8Array(level.layout.count).fill(-1);
    this.owners.set(level.initial);
    this.tileGlow = new Float32Array(level.layout.count);

    this.tileScale = (1 / level.size) * (1 - TILE_INSET);

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

    // The body is the visible surface beneath the squares: one closed box, so
    // the faces meet at the edges without any seam.
    this.bodyMaterial = this.makeMaterial("#1c2130", "#1c2130", 0.04);
    const body = new pc.Entity("cube-body");
    body.addComponent("render", { type: "box", material: this.bodyMaterial });
    body.setLocalScale(1, 1, 1);
    this.root.addChild(body);

    for (let i = 0; i < level.layout.count; i++) this.createTile(i);
    this.applyMaterials();

    this.device = app.graphicsDevice;
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
    entity.addComponent("render", { type: "box", material: this.emptyMaterial });
    entity.setLocalScale(this.tileScale, this.tileScale, TILE_THICKNESS);
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
    this.tiltTo(index >= 0 ? index : null);
  }

  private applyMaterials(): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const color = this.owners[i];
      const highlighted = i === this.hover || i === this.head;
      let material: pc.Material;
      if (color < 0) material = highlighted ? this.emptyHoverMaterial : this.emptyMaterial;
      else material = highlighted ? this.hoverMaterials[color] : this.colorMaterials[color];
      const render = this.tiles[i].render;
      if (render && render.material !== material) render.material = material;
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
  // orientation
  // -------------------------------------------------------------------------

  /**
   * Lean the cube a little so the active square faces the camera centre. The
   * three visible faces never change: the lean is capped at TILT_MAX, far below
   * the ~35 degrees that would bring another face into view.
   */
  tiltTo(square: number | null): void {
    const target = this.tiltTarget;
    if (square === null || square < 0) {
      target.set(0, 0, 0, 1);
    } else {
      const q = tiltQuat([
        this.layout.center[square * 3],
        this.layout.center[square * 3 + 1],
        this.layout.center[square * 3 + 2]
      ], TILT_MAX);
      target.set(q[0], q[1], q[2], q[3]);
    }

    const current = this.root.getLocalRotation();
    const dot =
      current.x * target.x + current.y * target.y + current.z * target.z + current.w * target.w;
    if (dot < 0) target.set(-target.x, -target.y, -target.z, -target.w);
    if (Math.abs(dot) > 0.9999) {
      this.root.setLocalRotation(target);
      this.tiltFrom.copy(target);
      this.tiltT = 1;
      this.tilting = false;
      return;
    }

    this.tiltFrom.copy(current);
    this.tiltT = 0;
    this.tilting = true;
  }

  private updateTilt(dt: number): void {
    if (!this.tilting) return;
    this.tiltT = Math.min(1, this.tiltT + dt / TILT_DURATION);
    const t = easeInOutCubic(this.tiltT);
    this.tiltTmp.slerp(this.tiltFrom, this.tiltTarget, t);
    this.root.setLocalRotation(this.tiltTmp);
    if (this.tiltT >= 1) this.tilting = false;
  }

  // -------------------------------------------------------------------------
  // picking
  // -------------------------------------------------------------------------

  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const px = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((clientY - rect.top) / rect.height) * this.canvas.height;
    const cam = this.camera.camera!;
    cam.screenToWorld(px, py, cam.nearClip, this.tmpA);
    cam.screenToWorld(px, py, cam.farClip, this.tmpB);

    this.tmpMat.copy(this.root.getWorldTransform()).invert();
    const origin = this.tmpMat.transformPoint(this.tmpA, this.tmpC);
    const dir = this.tmpD.copy(this.tmpB).sub(this.tmpA);
    this.tmpMat.transformVector(dir, dir);
    dir.normalize();

    let tmin = -Infinity;
    let tmax = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
      const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
      if (Math.abs(d) < 1e-9) {
        if (Math.abs(o) > PICK_HALF) return null;
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
      if (tmin > tmax) return null;
    }
    if (tmin < 0 || tmax < 0) return null;

    const hitX = origin.x + dir.x * tmin;
    const hitY = origin.y + dir.y * tmin;
    const hitZ = origin.z + dir.z * tmin;
    return projectToSquare(this.layout.size, hitX, hitY, hitZ);
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
      overlay.addComponent("render", { type: "box", material: mat });
      overlay.setLocalScale(1, 1, 0.1);
      overlay.setLocalPosition(0, 0, 0.5 + 0.05 + 0.02);
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
      const s = this.tileScale * scale;
      this.tiles[i].setLocalScale(s, s, TILE_THICKNESS);
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
