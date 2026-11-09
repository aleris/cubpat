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
  /** A tap that could not be played; the text says what to do instead. */
  onHint: (message: string) => void;
}

/**
 * One level in play.
 *
 * Paths survive the pointer: lifting it never throws away colour the player has
 * laid down, and pressing any coloured square truncates the path back to that
 * square (so the press that starts a drag also reopens the path there). A tap
 * on a grey square that touches the open end of a path colours it, which makes
 * the puzzle playable by tapping alone.
 */
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
  /** Colour touched last: the one a tap on a grey square extends. */
  private activeColor = -1;

  private readonly onPointerDown = (e: PointerEvent): void => this.pointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.pointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.pointerUp(e);
  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointerUp(e);
    this.renderer.clearCursor();
  };
  private readonly onPointerLeave = (): void => this.renderer.clearCursor();
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
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    app.on("update", this.onUpdate);
    canvas.style.cursor = "default";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.app.off("update", this.onUpdate);
    this.renderer.destroy();
  }

  reset(): void {
    this.owners.set(this.level.initial);
    for (const path of this.paths) path.length = 0;
    this.complete.fill(false);
    this.drag = null;
    this.activeColor = -1;
    this.solved = false;
    this.renderer.stopGlow();
    this.renderer.setHead(-1);
    this.renderer.setHover(-1);
    this.renderer.clearCursor();
    this.renderer.setBoard(this.owners, this.paths);
  }

  // -------------------------------------------------------------------------
  // pointer handling
  // -------------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.renderer.setCursor(e.clientX, e.clientY);

    const square = this.renderer.pick(e.clientX, e.clientY);
    if (square === null) return;

    const color = this.owners[square];
    if (color >= 0) {
      if (this.linkFromSquare(color, square)) return;
      this.beginPath(color, square);
    } else if (!this.growIntoEmpty(square)) return;

    this.beginDrag(this.activeColor);
  }

  private pointerMove(e: PointerEvent): void {
    // The lean follows every move, not just the square changes: that is what
    // slides the next square under the pointer.
    this.renderer.setCursor(e.clientX, e.clientY);
    const square = this.renderer.pick(e.clientX, e.clientY);
    if (square === null) {
      this.renderer.setHover(-1);
      return;
    }
    this.renderer.setHover(square);

    if (this.drag) {
      this.extend(square);
      return;
    }
    const playable = this.owners[square] >= 0 || this.isGrowable(square);
    this.canvas.style.cursor = playable ? "pointer" : "default";
  }

  private pointerUp(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const drag = this.drag;
    this.drag = null;
    this.renderer.setHead(-1);
    // A touch has no hover: drop the lean with the finger. A mouse keeps
    // leaning while it stays over the cube.
    if (e.pointerType !== "mouse") this.renderer.clearCursor();
    // Releasing short of the pair's second square keeps the path as drawn: the
    // player can pick it up again from any of its squares.
    if (drag && drag.reached) this.completeColor(drag.color);
  }

  // -------------------------------------------------------------------------
  // path rules
  // -------------------------------------------------------------------------

  /** Arm a drag from the open end of `color`'s path. */
  private beginDrag(color: number): void {
    const path = this.paths[color];
    if (path.length === 0) return;
    this.drag = { color, target: this.targetOf(color), reached: false };
    this.renderer.setHead(path[path.length - 1]);
    this.renderer.setBoard(this.owners, this.paths);
  }

  /** Square that completes `color`: the endpoint its path does not start from. */
  private targetOf(color: number): number {
    const path = this.paths[color];
    const [a, b] = this.level.endpoints[color];
    return path.length > 0 && path[0] === b ? a : b;
  }

  /**
   * A press on a coloured square resets the path to it: truncate when the square
   * is already on the path (pressing the start square clears everything after
   * it), otherwise abandon the old path and start a new one here.
   */
  private beginPath(color: number, square: number): void {
    const path = this.paths[color];
    const index = path.indexOf(square);
    if (index >= 0) {
      this.truncate(color, index);
    } else {
      this.resetColor(color);
      path.push(square);
      this.owners[square] = color;
    }
    this.activeColor = color;
  }

  /**
   * A press on the pair's second square links the colour when the path already
   * reaches the square in front of it: tapping the last square is as good as
   * dragging into it. Returns false when the press is not a finishing tap.
   */
  private linkFromSquare(color: number, square: number): boolean {
    const path = this.paths[color];
    if (path.length === 0 || this.complete[color]) return false;
    if (square !== this.targetOf(color)) return false;
    if (!areAdjacent(this.level.layout, path[path.length - 1], square)) return false;

    path.push(square);
    this.owners[square] = color;
    this.activeColor = color;
    this.renderer.setHead(-1);
    this.completeColor(color);
    return true;
  }

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
      this.renderer.setHead(path[path.length - 1]);
      this.renderer.setBoard(this.owners, this.paths);
      return;
    }

    if (drag.reached || this.complete[color]) return;
    if (!areAdjacent(this.level.layout, head, square)) return;
    const owner = this.owners[square];
    if (owner >= 0 && owner !== color) return;

    path.push(square);
    this.owners[square] = color;
    if (square === drag.target) drag.reached = true;

    this.renderer.setHead(square);
    this.renderer.setBoard(this.owners, this.paths);
  }

  /**
   * A press on a grey square colours it as the next square of the path whose
   * open end touches it. The colour touched last wins, then a sole candidate;
   * anything else is a miss and gets an instruction instead.
   */
  private growIntoEmpty(square: number): boolean {
    if (this.activeColor >= 0 && this.growInto(this.activeColor, square)) return true;

    let candidate = -1;
    for (let c = 0; c < this.level.colors; c++) {
      if (!this.touchesOpenEnd(c, square)) continue;
      if (candidate >= 0) {
        this.callbacks.onHint("Tap the end of the path you want to extend first");
        return false;
      }
      candidate = c;
    }
    if (candidate >= 0) return this.growInto(candidate, square);

    this.callbacks.onHint(this.emptyHint(square));
    return false;
  }

  /** Instruction for a tap on a grey square that no path can grow into. */
  private emptyHint(square: number): string {
    if (this.activeColor < 0) return "Tap a coloured square first, then a square next to it";
    for (let c = 0; c < this.level.colors; c++) {
      if (!this.complete[c]) continue;
      for (const pathSquare of this.paths[c]) {
        if (areAdjacent(this.level.layout, pathSquare, square)) {
          return "That colour is already linked — tap a square next to an unfinished path";
        }
      }
    }
    return "Tap a square next to the end of the path you are drawing";
  }

  /** True when `square` (grey) is the next free square of `color`'s path. */
  private touchesOpenEnd(color: number, square: number): boolean {
    if (this.complete[color]) return false;
    const path = this.paths[color];
    if (path.length > 0) return areAdjacent(this.level.layout, path[path.length - 1], square);
    // An untouched colour may be started from either of its two squares.
    const [a, b] = this.level.endpoints[color];
    return areAdjacent(this.level.layout, a, square) || areAdjacent(this.level.layout, b, square);
  }

  private isGrowable(square: number): boolean {
    if (this.owners[square] >= 0) return false;
    for (let c = 0; c < this.level.colors; c++) if (this.touchesOpenEnd(c, square)) return true;
    return false;
  }

  /** Colour a grey square as the next square of `color`'s path. */
  private growInto(color: number, square: number): boolean {
    if (!this.touchesOpenEnd(color, square)) return false;
    const path = this.paths[color];
    if (path.length === 0) {
      const [a, b] = this.level.endpoints[color];
      const start = areAdjacent(this.level.layout, a, square) ? a : b;
      path.push(start);
      this.owners[start] = color;
    }
    path.push(square);
    this.owners[square] = color;
    this.activeColor = color;
    return true;
  }

  private truncate(color: number, index: number): void {
    const path = this.paths[color];
    for (let i = index + 1; i < path.length; i++) {
      if (this.owners[path[i]] === color) this.owners[path[i]] = -1;
    }
    path.length = index + 1;
    for (const endpoint of this.level.endpoints[color]) this.owners[endpoint] = color;
    this.refreshComplete(color);
  }

  private resetColor(color: number): void {
    const path = this.paths[color];
    for (const square of path) {
      if (this.owners[square] === color) this.owners[square] = -1;
    }
    path.length = 0;
    for (const endpoint of this.level.endpoints[color]) this.owners[endpoint] = color;
    this.refreshComplete(color);
  }

  /** Keep "linked" honest after any edit: the path must join both endpoints. */
  private refreshComplete(color: number): void {
    const path = this.paths[color];
    const [a, b] = this.level.endpoints[color];
    const far = path.length > 0 && path[0] === a ? b : a;
    this.complete[color] = path.length >= 2 && path[path.length - 1] === far;
    this.solved = this.isSolved();
  }

  private completeColor(color: number): void {
    this.refreshComplete(color);
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
