import * as pc from "playcanvas";
import { areAdjacent } from "../core/layout.ts";
import type { Level } from "../core/level.ts";
import { CubeRenderer } from "../render/cube-renderer.ts";

/** Seconds between board re-checks while the level is unsolved. */
const RECHECK_INTERVAL = 0.4;

interface DragState {
  color: number;
  target: number;
  reached: boolean;
  /** Pressed on the last square of a linked path, which on its own changes nothing. */
  fromStop: boolean;
  /** The drag laid down at least one new square. */
  drew: boolean;
}

/**
 * Why a board that looks finished is not: every pair is linked but grey squares
 * are left over, or every square is coloured but a pair is still open.
 */
export type StuckReason = "unfilled" | "unlinked";

export interface SessionCallbacks {
  onSolved: () => void;
  onStuck: (reason: StuckReason) => void;
  /**
   * A tap that could not be played; the text says what to do instead.
   * `warning` marks a tap that looked like a move but was refused.
   */
  onHint: (message: string, tone?: "info" | "warning") => void;
}

/**
 * One level in play.
 *
 * Paths survive the pointer: lifting it never throws away colour the player has
 * laid down, and pressing any coloured square truncates the path back to that
 * square (so the press that starts a drag also reopens the path there). A tap
 * on a grey square that touches the open end of a path colours it, which makes
 * the puzzle playable by tapping alone. A drag that starts beside the cube turns
 * the cube to inspect its play faces, and releasing turns it back upright.
 *
 * Every edit is judged on release and again on a short timer, so a filled board
 * can never sit unsolved: see `settle`.
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
  /** Pointer currently driving the board; extra touches are ignored. */
  private activePointer: number | null = null;
  /** Pointer position at the last inspection-drag sample, in client pixels. */
  private lookX = 0;
  private lookY = 0;
  /** True while a drag on the empty space is turning the cube. */
  private looking = false;
  private disposed = false;
  /** Colour touched last: the one a tap on a grey square extends. */
  private activeColor = -1;
  /** The "continue an unfinished path" hint is shown once per level. */
  private unfinishedHinted = false;
  /** Seconds since the last periodic board check. */
  private recheckTimer = 0;

  private readonly onPointerDown = (e: PointerEvent): void => this.pointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.pointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.pointerUp(e);
  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointer) return;
    this.pointerUp(e);
    this.renderer.clearCursor();
  };
  private readonly onPointerLeave = (): void => {
    // A lost capture must not strand the cube at an inspection angle.
    if (this.looking) this.endLook();
    this.renderer.clearCursor();
  };
  private readonly onUpdate = (dt: number): void => {
    this.renderer.update(dt);
    // The board only changes through a gesture, which settles on release. This
    // timer is the belt and braces: a filled board is judged even if the final
    // edit's release was lost, and it carries no state of its own.
    this.recheckTimer += dt;
    if (this.recheckTimer < RECHECK_INTERVAL) return;
    this.recheckTimer = 0;
    if (!this.solved) this.settle();
  };

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
    this.activePointer = null;
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
    this.activePointer = null;
    this.activeColor = -1;
    this.solved = false;
    this.looking = false;
    this.renderer.endLook();
    this.renderer.stopGlow();
    this.renderer.setHead(-1);
    this.renderer.setHover(-1);
    this.renderer.clearCursor();
    this.renderer.setBoard(this.owners, this.paths);
  }

  /** Dev shortcut: install the generated solution and report the level solved. */
  solveNow(): void {
    if (this.solved) return;
    this.drag = null;
    this.activeColor = -1;
    for (let color = 0; color < this.level.colors; color++) {
      const path = this.level.solution[color];
      this.paths[color] = path.slice();
      for (const square of path) this.owners[square] = color;
      this.refreshComplete(color);
    }
    this.renderer.setHead(-1);
    this.renderer.setBoard(this.owners, this.paths);
  }

  // -------------------------------------------------------------------------
  // pointer handling
  // -------------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A second finger, or a palm resting on the glass, must not reopen,
    // truncate or extend the path the first finger is drawing.
    if (this.activePointer !== null) return;
    e.preventDefault();
    this.activePointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    // Deliberately no `setCursor` here: steering the cube on the press itself
    // slides squares under the finger, and the press would start a path from a
    // square the player never aimed at. The lean starts with the first move.
    const square = this.renderer.pick(e.clientX, e.clientY);
    if (square === null) {
      // Empty space around the cube: the drag turns the cube instead of
      // drawing, so the player can look at the play faces from another angle.
      this.beginLook(e.clientX, e.clientY);
      return;
    }

    const color = this.owners[square];
    let fromStop = false;
    if (color >= 0) {
      if (this.linkFromSquare(color, square)) return;
      const path = this.paths[color];
      fromStop = this.complete[color] && square === path[path.length - 1];
      this.beginPath(color, square);
    } else if (!this.growIntoEmpty(square)) return;

    this.beginDrag(this.activeColor, fromStop);
  }

  private pointerMove(e: PointerEvent): void {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    if (this.looking) {
      this.turnLook(e.clientX, e.clientY);
      return;
    }
    // The lean follows every move, not just the square changes: that is what
    // slides the next square under the pointer.
    this.renderer.setCursor(e.clientX, e.clientY);
    const square = this.renderer.pick(e.clientX, e.clientY);
    if (square === null) {
      this.canvas.style.cursor = "grab";
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
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const drag = this.drag;
    this.drag = null;
    this.renderer.setHead(-1);
    if (this.looking) {
      this.endLook();
      // A touch has no hover: drop the lean with the finger. A mouse keeps
      // leaning while it stays over the cube.
      if (e.pointerType !== "mouse") this.renderer.clearCursor();
      this.settle();
      return;
    }
    // A touch has no hover: drop the lean with the finger. A mouse keeps
    // leaning while it stays over the cube.
    if (e.pointerType !== "mouse") this.renderer.clearCursor();
    if (!drag) {
      this.settle();
      return;
    }
    if (drag.reached) {
      this.completeColor(drag.color);
    } else if (drag.fromStop && this.complete[drag.color] && e.type === "pointerup") {
      // A tap on a linked path's last square leaves it as is; dragging back from
      // there truncates and clears `complete`, so only a plain tap gets the hint.
      this.callbacks.onHint("This path is linked — tap its start square to reset it", "warning");
    } else if (drag.drew && !this.complete[drag.color] && !this.unfinishedHinted) {
      // Releasing short of the pair's second square keeps the path as drawn;
      // say so once, so the player knows the path can be picked up again.
      this.unfinishedHinted = true;
      this.callbacks.onHint("You can continue any path later from where you left it");
    }
    this.settle();
  }

  /** Start turning the cube from a drag that began beside it. */
  private beginLook(x: number, y: number): void {
    this.looking = true;
    this.lookX = x;
    this.lookY = y;
    this.renderer.setHover(-1);
    this.renderer.startLook();
    this.canvas.style.cursor = "grabbing";
  }

  /** Feed the inspection drag a pointer move, in client pixels. */
  private turnLook(x: number, y: number): void {
    const dx = x - this.lookX;
    const dy = y - this.lookY;
    this.lookX = x;
    this.lookY = y;
    this.renderer.look(dx, dy);
  }

  /** Let go of the cube: it turns back to its rest orientation. */
  private endLook(): void {
    this.looking = false;
    this.renderer.endLook();
    this.canvas.style.cursor = "default";
  }

  // -------------------------------------------------------------------------
  // path rules
  // -------------------------------------------------------------------------

  /** Arm a drag from the open end of `color`'s path. */
  private beginDrag(color: number, fromStop = false): void {
    const path = this.paths[color];
    if (path.length === 0) return;
    this.drag = { color, target: this.targetOf(color), reached: false, fromStop, drew: false };
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
    drag.drew = true;
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

    this.showEmptyHint(square);
    return false;
  }

  /** Explain a tap on a grey square that no path can grow into. */
  private showEmptyHint(square: number): void {
    if (this.activeColor < 0) {
      this.callbacks.onHint("Tap a coloured square first, then a square next to it");
      return;
    }
    for (let c = 0; c < this.level.colors; c++) {
      if (!this.complete[c]) continue;
      for (const pathSquare of this.paths[c]) {
        if (areAdjacent(this.level.layout, pathSquare, square)) {
          this.callbacks.onHint("That colour is already linked — tap a square next to an unfinished path", "warning");
          return;
        }
      }
    }
    this.callbacks.onHint("Tap a square next to the end of the path you are drawing");
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
    this.updateSolved();
  }

  /**
   * Report the solve the moment the board is complete, and keep the finished
   * board glowing. The celebration is decoration: it can be cut short by a
   * reset, an undo or leaving the level, so nothing may depend on it finishing.
   */
  private updateSolved(): void {
    if (!this.isSolved()) {
      if (this.solved) this.renderer.stopGlow();
      this.solved = false;
      return;
    }
    if (this.solved) return;
    this.solved = true;
    this.renderer.startCelebration(this.paths);
    this.callbacks.onSolved();
  }

  private completeColor(color: number): void {
    this.renderer.setBoard(this.owners, this.paths);
    this.renderer.playPathGlow(color, this.paths[color].slice());
    // Judged last, so a solve replaces this path's single glow with the loop.
    this.refreshComplete(color);
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

  /** Every square wears a colour. */
  private isFilled(): boolean {
    for (let i = 0; i < this.owners.length; i++) if (this.owners[i] < 0) return false;
    return true;
  }

  /**
   * Judge the board once an edit has landed: report the solve, or say what is
   * still missing.
   *
   * A path that ends beside its pair's far endpoint is deliberately left open.
   * The endpoint square is pre-coloured, so the board can look finished while
   * the pair is not, but the player may still want to route the path around
   * that square instead of into it; only playing the endpoint square itself
   * finishes such a pair.
   */
  private settle(): void {
    if (this.disposed || this.drag || this.looking) return;
    this.updateSolved();
    if (!this.solved) this.reportStuck();
  }

  /**
   * Explain a board that looks finished but is not: grey squares left over, or
   * every square coloured with a pair still open. `main.ts` keeps the message to
   * one per level, so a stuck player is told once and not nagged.
   */
  private reportStuck(): void {
    if (this.isFilled()) {
      this.callbacks.onStuck("unlinked");
      return;
    }
    if (this.isFullyLinked()) this.callbacks.onStuck("unfilled");
  }
}
