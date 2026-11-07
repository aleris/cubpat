import * as pc from "playcanvas";
import { CubeRenderer } from "./cube-view.ts";
import { areAdjacent } from "./layout.ts";
import type { Level } from "./levels.ts";

interface DragState {
  color: number;
  target: number;
  reached: boolean;
}

export interface SessionCallbacks {
  onSolved: () => void;
  /** Every pair is linked but grey squares are left over. */
  onAllLinked: () => void;
}

export class LevelSession {
  readonly level: Level;
  readonly renderer: CubeRenderer;
  readonly owners: Int8Array;
  readonly paths: number[][];
  readonly complete: boolean[];
  solved = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly app: pc.AppBase;
  private readonly callbacks: SessionCallbacks;
  private drag: DragState | null = null;
    private disposed = false;

  private readonly onPointerDown = (e: PointerEvent): void => this.pointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.pointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.pointerUp(e);
  private readonly onUpdate = (dt: number): void => this.renderer.update(dt);

  constructor(app: pc.AppBase, camera: pc.Entity, canvas: HTMLCanvasElement, level: Level, callbacks: SessionCallbacks) {
    this.app = app;
    this.canvas = canvas;
    this.level = level;
    this.callbacks = callbacks;
    this.renderer = new CubeRenderer(app, camera, level);
    this.owners = new Int8Array(level.layout.count).fill(-1);
    this.owners.set(level.initial);
    this.paths = Array.from({ length: level.colors }, () => [] as number[]);
    this.complete = new Array(level.colors).fill(false);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    app.on("update", this.onUpdate);
    canvas.style.cursor = "grab";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.app.off("update", this.onUpdate);
    this.renderer.destroy();
  }

  reset(): void {
    this.owners.set(this.level.initial);
    for (const path of this.paths) path.length = 0;
    this.complete.fill(false);
    this.drag = null;
    this.solved = false;
    this.renderer.stopGlow();
    this.renderer.setHead(-1);
    this.renderer.setHover(-1);
    this.renderer.setBoard(this.owners, this.paths);
  }

  // -------------------------------------------------------------------------
  // pointer handling
  // -------------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    const square = this.renderer.pick(e.clientX, e.clientY);
    if (square === null) return;
    const color = this.owners[square];
    if (color < 0) return;

    const [a, b] = this.level.endpoints[color];
    if (square === a || square === b) {
      this.resetColor(color);
      this.paths[color] = [square];
      this.owners[square] = color;
      this.drag = { color, target: square === a ? b : a, reached: false };
    } else {
      const path = this.paths[color];
      const index = path.indexOf(square);
      if (index < 0) return;
      this.truncate(color, index);
      this.drag = { color, target: path[0] === a ? b : a, reached: false };
    }
    this.renderer.setHead(square);
    this.renderer.setBoard(this.owners, this.paths);
  }

  private pointerMove(e: PointerEvent): void {
    const square = this.renderer.pick(e.clientX, e.clientY);

    if (square === null) {
      this.renderer.setHover(-1);
      return;
    }
    this.renderer.setHover(square);

    if (!this.drag) {
      this.canvas.style.cursor = this.owners[square] >= 0 ? "pointer" : "grab";
      return;
    }

    this.extend(square);
  }

  private pointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const drag = this.drag;
    this.drag = null;
    this.renderer.setHead(-1);
    if (!drag) return;

    if (drag.reached) {
      this.completeColor(drag.color);
    } else {
      this.resetColor(drag.color);
      this.renderer.setBoard(this.owners, this.paths);
    }
  }

  // -------------------------------------------------------------------------
  // path rules
  // -------------------------------------------------------------------------

  private extend(square: number): void {
    const drag = this.drag;
    if (!drag) return;
    const color = drag.color;
    const path = this.paths[color];
    if (path.length === 0) return;
    const head = path[path.length - 1];
    if (square === head) return;

    const existing = path.indexOf(square);
    if (existing >= 0) {
      this.truncate(color, existing);
      this.renderer.setHead(square);
      this.renderer.setBoard(this.owners, this.paths);
      return;
    }

    if (drag.reached) return;
    if (!areAdjacent(this.level.layout, head, square)) return;
    const owner = this.owners[square];
    if (owner >= 0 && owner !== color) return;

    path.push(square);
    this.owners[square] = color;
    if (square === drag.target) drag.reached = true;

    this.renderer.setHead(square);
    this.renderer.setBoard(this.owners, this.paths);
  }

  private truncate(color: number, index: number): void {
    const path = this.paths[color];
    for (let i = index + 1; i < path.length; i++) {
      if (this.owners[path[i]] === color) this.owners[path[i]] = -1;
    }
    path.length = index + 1;
    this.complete[color] = false;
    this.solved = false;
    for (const endpoint of this.level.endpoints[color]) this.owners[endpoint] = color;
  }

  private resetColor(color: number): void {
    const path = this.paths[color];
    for (const square of path) {
      if (this.owners[square] === color) this.owners[square] = -1;
    }
    path.length = 0;
    this.complete[color] = false;
    this.solved = false;
    for (const endpoint of this.level.endpoints[color]) this.owners[endpoint] = color;
  }

  private completeColor(color: number): void {
    this.complete[color] = true;
    this.solved = this.isSolved();
    this.renderer.setBoard(this.owners, this.paths);
    if (!this.solved && this.isFullyLinked()) this.callbacks.onAllLinked();
    this.renderer.playPathGlow(color, this.paths[color].slice(), () => {
      if (this.disposed || this.drag) return;
      this.solved = this.isSolved();
      if (this.solved) this.callbacks.onSolved();
    });
  }

  /** Every pair linked and every square coloured. */
  private isSolved(): boolean {
    for (let c = 0; c < this.level.colors; c++) if (!this.complete[c]) return false;
    for (let i = 0; i < this.owners.length; i++) if (this.owners[i] < 0) return false;
    return true;
  }

  private isFullyLinked(): boolean {
    for (let c = 0; c < this.level.colors; c++) if (!this.complete[c]) return false;
    return true;
  }
}
