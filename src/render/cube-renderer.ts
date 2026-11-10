import * as pc from "playcanvas";
import { FACES, projectToSquare, type CubeLayout } from "../core/layout.ts";
import type { Level } from "../core/level.ts";
import { cross, dot, madd, quatMul, type Quat, type Vec3 } from "../core/math.ts";
import { TILT_MAX, advanceLook, playFacesFacing, tiltQuat } from "../core/view.ts";
import { drawIconAtlas } from "./icon-atlas.ts";
import { drawTilePattern, TILE_PATTERN_SIZE } from "./tile-patterns.ts";
import {
  pushHalfTorus,
  pushQuad,
  roundedCubeMesh,
  roundedTileMesh,
  type MeshData
} from "./meshes.ts";

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

/**
 * Radius of the cube body's edge bevel (world units). Small enough to hide
 * under the squares: the nearest square edge is at most 0.06/size from a face
 * edge (0.01 at size 6) and tiles sink 0.009 into the body, so the bevel never
 * leaves a gap beneath a tile.
 */
const BODY_BEVEL = 0.02;
const PICK_HALF = 0.5 + TILE_THICKNESS;
/** Time constant of the lean as it follows the pointer, in seconds. */
const TILT_FOLLOW = 0.08;
/** Radians the cube turns per CSS pixel of an inspection drag. */
const LOOK_RATE = 0.004;
/** Time constant of the inspection turn as it follows the drag and returns. */
const LOOK_FOLLOW = 0.08;
/**
 * Distance beyond the cube over which the lean fades out, in cube widths.
 * The pointer keeps steering the cube just outside the silhouette, and a
 * pointer far from it barely tips the view.
 */
const LEAN_FADE = 0.18;

const clampHalf = (v: number): number => (v < -PICK_HALF ? -PICK_HALF : v > PICK_HALF ? PICK_HALF : v);

const GLOW_RISE = 0.08;
const GLOW_SETTLE = 0.3;
const GLOW_SUSTAIN = 0.4;
const GLOW_HOLD = 0.25;
const GLOW_FADE = 0.35;

/** Lift of the start/stop icons above the cube surface (above the stitches). */
const ICON_LIFT = 0.029;
/** Start/stop icon edge length, as a fraction of the square size. */
const ICON_SIZE = 0.62;

/** Length of the level-start flight, in seconds. */
const INTRO_DURATION = 1.5;
/** How far behind its rest position the cube starts, along the view direction. */
const INTRO_DISTANCE = 20;
/** Full turns the cube spins on its way in. */
const INTRO_TURNS = 1.25;
/** Tumble axis of the flight, tilted off the vertical so the spin reads in 3D. */
const INTRO_AXIS = new pc.Vec3(0.35, 1, 0.2).normalize();

/** Top of a tile above the cube face plane. */
const TILE_TOP = TILE_OFFSET - 0.5 + TILE_THICKNESS / 2;
/** Stitch thread radius, as a fraction of the tile width. */
const STITCH_RADIUS = 0.1;
/**
 * Each stitch foot sits this fraction of a tile width in from the tile edge
 * facing the other tile, so a loop is a third of a width wide on either side.
 */
const STITCH_FOOT = 1 / 6;
/** How deep a stitch end sinks into the tile, as a multiple of its radius. */
const STITCH_SINK = 0.5;

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

  /** Parent of `look` that carries the level-start flight. */
  private readonly stage: pc.Entity;
  /** Parent of `root` that carries the drag turn; `root` keeps the lean. */
  private readonly lookPivot: pc.Entity;
  private introTime = 0;
  private readonly introFrom = new pc.Vec3();
  private readonly introQuat = new pc.Quat();

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
  private readonly stitchMarks: pc.Entity;
  private readonly iconMarks: pc.Entity;
  private readonly stitchMeshes: pc.Mesh[] = [];
  private readonly iconMaterial: pc.StandardMaterial;
  private readonly iconTexture: pc.Texture;
  private readonly patternTextures: pc.Texture[] = [];

  private owners: Int8Array;
  private paths: readonly number[][] = [];
  private hover = -1;
  private head = -1;
  private time = 0;

  /** Lean the cube follows: the surface under the pointer, turned to the camera. */
  private readonly tiltTarget = new pc.Quat();
  private readonly tiltTmp = new pc.Quat();
  private readonly tiltUpright = new pc.Quat();
  /** Drag turn the cube follows, and whether a drag is driving it. */
  private readonly lookTarget = new pc.Quat();
  private readonly lookTmp = new pc.Quat();
  private readonly leanTmp = new pc.Quat();
  private readonly focusPoint: Vec3 = [0, 0, 0];

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
    this.device = app.graphicsDevice;
    this.canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    this.owners = new Int8Array(level.layout.count).fill(-1);
    this.owners.set(level.initial);
    this.tileGlow = new Float32Array(level.layout.count);

    this.emptyMaterial = this.makeMaterial("#313748", "#000000", 0);
    this.emptyHoverMaterial = this.makeMaterial("#525a72", "#12151f", 0);
    for (let i = 0; i < level.palette.length; i++) {
      const hex = level.palette[i];
      const pattern = this.makePatternTexture(i);
      this.patternTextures.push(pattern);
      this.colorMaterials.push(this.makeMaterial(hex, hex, 0.07, false, pattern));
      this.hoverMaterials.push(this.makeMaterial(hex, "#ffffff", 0.2, true, pattern));
    }

    this.stage = new pc.Entity("cube-stage");
    app.root.addChild(this.stage);
    this.lookPivot = new pc.Entity("cube-look");
    this.stage.addChild(this.lookPivot);
    this.root = new pc.Entity("cube-root");
    this.lookPivot.addChild(this.root);
    this.root.setLocalRotation(new pc.Quat());

    // The body is the visible surface beneath the squares: one closed box with
    // bevelled edges and corners, so the faces meet without a seam and the
    // silhouette catches a highlight instead of a razor edge.
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

    this.stitchMarks = new pc.Entity("stitch-marks");
    this.stitchMarks.addComponent("render");
    this.root.addChild(this.stitchMarks);
    this.iconMarks = new pc.Entity("icon-marks");
    this.iconMarks.addComponent("render");
    this.root.addChild(this.iconMarks);
    this.rebuildMarkers();

    // Start far down the view direction so the first frame is already in flight.
    this.introFrom.copy(camera.forward).mulScalar(INTRO_DISTANCE);
    this.updateIntro(0);
  }

  // -------------------------------------------------------------------------
  // construction helpers
  // -------------------------------------------------------------------------

  private makeMaterial(
    hex: string,
    emissiveHex: string,
    emissiveScale: number,
    lighten = false,
    map?: pc.Texture
  ): pc.StandardMaterial {
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
    if (map) mat.diffuseMap = map;
    mat.update();
    return mat;
  }

  private makePatternTexture(index: number): pc.Texture {
    const texture = new pc.Texture(this.device, {
      width: TILE_PATTERN_SIZE,
      height: TILE_PATTERN_SIZE,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      anisotropy: 8
    });
    texture.setSource(drawTilePattern(index));
    return texture;
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
  // path markers: start/stop icons and a stitch loop between each pair
  // -------------------------------------------------------------------------

  private centreOf(square: number): Vec3 {
    const c = this.layout.center;
    return [c[square * 3], c[square * 3 + 1], c[square * 3 + 2]];
  }

  private rebuildMarkers(): void {
    const s = 1 / this.level.size;
    const stitches = new Map<number, MeshData>();
    const icons: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
    const half = (ICON_SIZE * s) / 2;
    // Icons lie flat on their square, aligned with the tile grid. Of the four
    // grid directions, the glyph's +u takes the one closest to screen right
    // (rest pose, so a mid-tilt rebuild picks the same one), so ▶ reads as
    // "play" on every face. Canvas rows run downwards, hence v from 1 at the
    // bottom edge to 0 at the top.
    const right = this.camera.right;
    const camR: Vec3 = [right.x, right.y, right.z];

    for (let c = 0; c < this.paths.length; c++) {
      const path = this.paths[c];
      if (!path || path.length === 0) continue;
      const start = path[0];
      const [ea, eb] = this.level.endpoints[c];
      const stop = start === ea ? eb : ea;

      for (const [square, u0] of [[start, 0], [stop, 0.5]] as const) {
        const basis = FACES[this.layout.face[square]];
        const n = basis.n as Vec3;
        let ax = basis.u as Vec3;
        for (const axis of [basis.u, basis.v] as Vec3[]) {
          for (const sign of [1, -1]) {
            const k = dot(axis, camR) * sign;
            if (k > dot(ax, camR)) ax = [axis[0] * sign, axis[1] * sign, axis[2] * sign];
          }
        }
        pushQuad(icons, madd(this.centreOf(square), n, ICON_LIFT), ax, cross(n, ax), half, half, n, u0, u0 + 0.5, 1, 0);
      }

      for (let k = 0; k + 1 < path.length; k++) {
        let data = stitches.get(c);
        if (!data) {
          data = { positions: [], normals: [], uvs: [], indices: [] };
          stitches.set(c, data);
        }
        this.pushStitch(data, path[k], path[k + 1], s);
      }
    }

    this.setStitches(stitches);
    this.setMarkerMesh(this.iconMarks, icons, this.iconMaterial);
  }

  /**
   * One stitch linking neighbouring squares `a` and `b`: a half torus in the
   * colour of their path, its feet a third of a tile width in from the tile
   * edge facing the other square. Same-face links arch straight over the gap
   * between the tiles; links across a cube edge lift both feet clear of the
   * tiles, so the loop bridges the cube's bevel instead of cutting into it.
   */
  private pushStitch(m: MeshData, a: number, b: number, s: number): void {
    const fa = this.layout.face[a];
    const fb = this.layout.face[b];
    const nA = FACES[fa].n;
    const nB = FACES[fb].n;
    const A = this.centreOf(a);
    const B = this.centreOf(b);
    const width = s * (1 - TILE_INSET);
    const radius = width * STITCH_RADIUS;
    // a third of a width in from the edge leaves the foot one sixth of a
    // width from the square's centre, on the side of the linked square
    const reach = width * (0.5 - STITCH_FOOT);
    const lift = TILE_TOP - STITCH_SINK * radius;

    let pA: Vec3;
    let pB: Vec3;
    let bulge: Vec3;
    if (fa === fb) {
      const d = madd(B, A, -1);
      const len = Math.hypot(d[0], d[1], d[2]);
      const along: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
      pA = madd(madd(A, along, reach), nA, lift);
      pB = madd(madd(B, along, -reach), nA, lift);
      bulge = nA;
    } else {
      // On a square's face the step to a shared cube edge runs along the
      // other face's normal, so the feet stay on their faces.
      pA = madd(madd(A, nB, reach), nA, lift);
      pB = madd(madd(B, nA, reach), nB, lift);
      bulge = [nA[0] + nB[0], nA[1] + nB[1], nA[2] + nB[2]];
    }
    pushHalfTorus(m, pA, pB, bulge, radius);
  }

  /** One lit 3D mesh per colour: the stitches share the tile's own material. */
  private setStitches(byColor: Map<number, MeshData>): void {
    for (const mesh of this.stitchMeshes) mesh.destroy();
    this.stitchMeshes.length = 0;
    const instances: pc.MeshInstance[] = [];
    for (const [color, data] of byColor) {
      if (data.indices.length === 0) continue;
      const mesh = new pc.Mesh(this.device);
      mesh.setPositions(data.positions);
      mesh.setNormals(data.normals);
      mesh.setIndices(data.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      this.stitchMeshes.push(mesh);
      instances.push(new pc.MeshInstance(mesh, this.colorMaterials[color]));
    }
    const render = this.stitchMarks.render!;
    render.meshInstances = instances;
    this.stitchMarks.enabled = instances.length > 0;
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
    if (!this.screenRay(clientX, clientY)) {
      this.clearCursor();
      return;
    }
    const miss = this.aimPoint(this.tmpA, this.tmpB, this.tmpC);
    this.focusPoint[0] = this.tmpC.x;
    this.focusPoint[1] = this.tmpC.y;
    this.focusPoint[2] = this.tmpC.z;
    const q = tiltQuat(this.focusPoint, TILT_MAX);
    // Off the cube the aim point stays on the nearest bit of surface, and the
    // lean fades with the distance past it: steering keeps working just outside
    // the edge, and a pointer far away barely tips the view. Nothing jumps as
    // the pointer crosses the silhouette.
    const fade = 1 / (1 + (miss / LEAN_FADE) ** 2);
    this.tiltTmp.set(q[0], q[1], q[2], q[3]);
    this.tiltTarget.slerp(this.tiltUpright, this.tiltTmp, fade);
  }

  /** Rest the cube upright (pointer off the cube, or a touch lifted). */
  clearCursor(): void {
    this.tiltTarget.set(0, 0, 0, 1);
  }

  // -------------------------------------------------------------------------
  // inspection: dragging the empty space around the cube turns it
  // -------------------------------------------------------------------------

  /** Take the cube for an inspection drag; the lean drops to upright. */
  startLook(): void {
    this.tiltTarget.set(0, 0, 0, 1);
  }

  /**
   * Turn the cube by a pointer move of `dx`, `dy` CSS pixels. A horizontal
   * move spins it about the screen's up axis and a vertical one about its
   * right axis, so the visible surface follows the pointer. The turn stops
   * where the three play faces would leave the view.
   */
  look(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const up = this.camera.up;
    const right = this.camera.right;
    let q: Quat = [this.lookTarget.x, this.lookTarget.y, this.lookTarget.z, this.lookTarget.w];
    q = advanceLook(q, [up.x, up.y, up.z], dx * LOOK_RATE);
    q = advanceLook(q, [right.x, right.y, right.z], dy * LOOK_RATE);
    this.lookTarget.set(q[0], q[1], q[2], q[3]);
  }

  /** Release the cube: it turns back to its rest orientation. */
  endLook(): void {
    this.lookTarget.set(0, 0, 0, 1);
  }

  private updateLook(dt: number): void {
    const target = this.lookTarget;
    const current = this.lookPivot.getLocalRotation();
    const dot = Math.abs(
      current.x * target.x + current.y * target.y + current.z * target.z + current.w * target.w
    );
    if (dot > 0.999999999) return;
    this.lookTmp.slerp(current, target, 1 - Math.exp(-dt / LOOK_FOLLOW));
    this.lookPivot.setLocalRotation(this.lookTmp);
  }

  /** True while `lean` on top of the inspection turn `look` keeps the play
   *  faces towards the camera. */
  private facesFacing(look: pc.Quat, lean: pc.Quat): boolean {
    return playFacesFacing(
      quatMul([look.x, look.y, look.z, look.w], [lean.x, lean.y, lean.z, lean.w])
    );
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
    // The turn and the lean both rotate the cube, so it is their product that
    // has to clear the inspection limit: a lean added on top of a turn held at
    // the limit would otherwise push a play face out of view.
    if (!this.facesFacing(this.lookPivot.getLocalRotation(), this.tiltTmp)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        this.leanTmp.slerp(this.tiltUpright, this.tiltTmp, mid);
        if (this.facesFacing(this.lookPivot.getLocalRotation(), this.leanTmp)) lo = mid;
        else hi = mid;
      }
      this.root.setLocalRotation(this.leanTmp.slerp(this.tiltUpright, this.tiltTmp, lo));
      return;
    }
    this.root.setLocalRotation(this.tiltTmp);
  }

  // -------------------------------------------------------------------------
  // level-start flight: the cube spins in from far away to a hard stop
  // -------------------------------------------------------------------------

  private updateIntro(dt: number): void {
    if (this.introTime >= INTRO_DURATION) return;
    this.introTime += dt;
    // Ease-in cubic: creeps away, then accelerates into a hard stop at t = 1.
    const t = Math.min(1, this.introTime / INTRO_DURATION);
    const remaining = 1 - t * t * t;
    this.stage.setLocalPosition(
      this.introFrom.x * remaining,
      this.introFrom.y * remaining,
      this.introFrom.z * remaining
    );
    this.introQuat.setFromAxisAngle(INTRO_AXIS, INTRO_TURNS * 360 * remaining);
    this.stage.setLocalRotation(this.introQuat);
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
    // CameraComponent.screenToWorld measures points in CSS pixels (it divides
    // by device.clientRect, not the drawing buffer), so this must not scale by
    // canvas.width/height: that factor is the pixel ratio on retina screens and
    // would offset every pick by the same amount.
    const px = clientX - rect.left;
    const py = clientY - rect.top;
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
    let beside = false;
    for (let axis = 0; axis < 3; axis++) {
      const o = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z;
      const d = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
      if (Math.abs(d) < 1e-9) {
        if (Math.abs(o) > PICK_HALF) beside = true;
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
    }
    if (beside || tmin < 0 || tmin > tmax) return false;
    out.copy(dir).mulScalar(tmin).add(origin);
    return true;
  }

  /**
   * Point of the cube the lean aims at: the entry point when the ray hits, and
   * the nearest point of the cube when it misses, so the aim stays defined and
   * continuous as the pointer crosses the silhouette. Returns the distance from
   * the ray to the cube, zero when it hits.
   */
  private aimPoint(origin: pc.Vec3, dir: pc.Vec3, out: pc.Vec3): number {
    if (this.hitCube(origin, dir, out)) return 0;

    // The squared distance from a ray point to the box is convex in the ray
    // parameter, so its slope is monotone and a bisection lands on the minimum.
    // Clamping alternately does not: near an edge it crawls, and an unconverged
    // answer makes the aim jump as the pointer crosses the silhouette.
    let hi = Math.max(-(origin.x * dir.x + origin.y * dir.y + origin.z * dir.z), 0);
    for (let i = 0; i < 24 && this.cubeSlope(origin, dir, hi) < 0; i++) hi = hi > 0 ? hi * 2 : 0.5;
    let lo = 0;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) * 0.5;
      if (this.cubeSlope(origin, dir, mid) < 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    out.copy(dir).mulScalar((lo + hi) * 0.5).add(origin);
    const miss = Math.hypot(
      out.x - clampHalf(out.x),
      out.y - clampHalf(out.y),
      out.z - clampHalf(out.z)
    );
    out.set(clampHalf(out.x), clampHalf(out.y), clampHalf(out.z));
    return miss;
  }

  /**
   * Half the slope of the squared distance from the point at `t` on the ray to
   * the cube: the signed excess over each face times the ray direction.
   */
  private cubeSlope(origin: pc.Vec3, dir: pc.Vec3, t: number): number {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const ex = x > PICK_HALF ? x - PICK_HALF : x < -PICK_HALF ? x + PICK_HALF : 0;
    const ey = y > PICK_HALF ? y - PICK_HALF : y < -PICK_HALF ? y + PICK_HALF : 0;
    const ez = z > PICK_HALF ? z - PICK_HALF : z < -PICK_HALF ? z + PICK_HALF : 0;
    return ex * dir.x + ey * dir.y + ez * dir.z;
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
    this.updateIntro(dt);
    this.updateLook(dt);
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
    this.stage.destroy();
    for (const mesh of this.stitchMeshes) mesh.destroy();
    this.emptyMaterial.destroy();
    this.emptyHoverMaterial.destroy();
    for (const mat of this.colorMaterials) mat.destroy();
    for (const mat of this.hoverMaterials) mat.destroy();
    this.bodyMaterial.destroy();
    this.iconMaterial.destroy();
    this.iconTexture.destroy();
    for (const texture of this.patternTextures) texture.destroy();
  }
}
