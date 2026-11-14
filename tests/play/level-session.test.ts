import { describe, expect, it, vi } from "vitest";
import { LEVEL_CONFIGS } from "../../src/core/curve.ts";
import { areAdjacent } from "../../src/core/layout.ts";
import { generateLevel, solvedColors, type Level } from "../../src/core/level.ts";
import { LevelSession, type StuckReason } from "../../src/play/level-session.ts";

const rendererState = vi.hoisted(() => ({
  instance: null as null | { destroyed: boolean },
  pick: null as number | null,
  looks: [] as Array<[number, number]>,
  cursors: [] as Array<[number, number]>,
  celebrations: [] as number[][][],
  glows: [] as Array<[number, number[]]>,
  endedLooks: 0
}));

vi.mock("../../src/render/cube-renderer.ts", () => {
  class CubeRenderer {
    destroyed = false;

    constructor(_app: unknown, _camera: unknown, _level: unknown) {
      rendererState.instance = this;
    }

    pick(): number | null {
      return rendererState.pick;
    }

    setCursor(x: number, y: number): void {
      rendererState.cursors.push([x, y]);
    }
    setHover(): void {}
    setHead(): void {}
    setBoard(): void {}
    clearCursor(): void {}
    stopGlow(): void {}
    startLook(): void {}

    look(dx: number, dy: number): void {
      rendererState.looks.push([dx, dy]);
    }

    endLook(): void {
      rendererState.endedLooks++;
    }

    playPathGlow(color: number, path: number[]): void {
      rendererState.glows.push([color, path.slice()]);
    }

    startCelebration(paths: readonly number[][]): void {
      rendererState.celebrations.push(paths.map((path) => path.slice()));
    }

    update(): void {}

    destroy(): void {
      this.destroyed = true;
    }
  }

  return { CubeRenderer };
});

type Handler = (event: Record<string, unknown>) => void;

class FakeCanvas {
  style: { cursor: string } = { cursor: "default" };
  private readonly listeners = new Map<string, Handler>();

  addEventListener(type: string, handler: Handler): void {
    this.listeners.set(type, handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    if (this.listeners.get(type) === handler) this.listeners.delete(type);
  }

  setPointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  releasePointerCapture(): void {}

  emit(type: string, overrides: Record<string, unknown> = {}): void {
    this.listeners.get(type)?.({
      pointerType: "mouse",
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault(): void {},
      ...overrides
    });
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

interface Harness {
  session: LevelSession;
  callbacks: { onSolved: () => void; onStuck: (reason: StuckReason) => void; onHint: (message: string, tone?: "info" | "warning") => void };
  canvas: FakeCanvas;
  press: (square: number) => void;
  move: (square: number) => void;
  release: () => void;
  tick: (dt: number) => void;
}

function makeSession(level: Level): Harness {
  const callbacks = { onSolved: vi.fn(), onStuck: vi.fn(), onHint: vi.fn() };
  const canvas = new FakeCanvas();
  const updates: Array<(dt: number) => void> = [];
  const app = {
    on: (name: string, handler: (dt: number) => void) => {
      if (name === "update") updates.push(handler);
    },
    off: vi.fn()
  };
  const session = new LevelSession(
    app as never,
    {} as never,
    canvas as unknown as HTMLCanvasElement,
    level,
    callbacks
  );
  rendererState.pick = null;
  rendererState.looks.length = 0;
  rendererState.cursors.length = 0;
  rendererState.celebrations.length = 0;
  rendererState.glows.length = 0;
  rendererState.endedLooks = 0;

  const press = (square: number): void => {
    rendererState.pick = square;
    canvas.emit("pointerdown");
  };
  const move = (square: number): void => {
    rendererState.pick = square;
    canvas.emit("pointermove");
  };
  const release = (): void => {
    canvas.emit("pointerup");
  };
  /** Advance the app clock, which is what drives the periodic board check. */
  const tick = (dt: number): void => {
    for (const handler of updates) handler(dt);
  };
  return { session, callbacks, canvas, press, move, release, tick };
}

/** Tap a colour's squares in order, starting from one of its endpoints. */
function tapAlong(run: Harness, path: number[]): void {
  run.press(path[0]);
  run.release();
  for (let i = 1; i < path.length; i++) {
    run.press(path[i]);
    run.release();
  }
}

function isolatedGreySquare(level: Level): number {
  const square = Array.from({ length: level.layout.count }, (_, index) => index).find(
    (candidate) =>
      level.initial[candidate] === -1 &&
      level.endpoints.every(
        ([a, b]) =>
          !areAdjacent(level.layout, a, candidate) && !areAdjacent(level.layout, b, candidate)
      )
  );
  if (square === undefined) throw new Error("expected a grey square away from every endpoint");
  return square;
}

describe("LevelSession", () => {
  it("starts from the level's endpoint pairs with no paths drawn", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session } = makeSession(level);
    expect(Array.from(session.owners)).toEqual(Array.from(level.initial));
    expect(session.paths).toHaveLength(level.colors);
    expect(session.paths.every((path) => path.length === 0)).toBe(true);
    expect(session.complete.every((linked) => !linked)).toBe(true);
    expect(session.solved).toBe(false);
  });

  it("links every pair by dragging its solution and reports the solve once", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session, callbacks, press, move, release } = makeSession(level);

    for (const path of level.solution) {
      press(path[0]);
      for (let i = 1; i < path.length; i++) move(path[i]);
      release();
    }

    expect(session.complete.every(Boolean)).toBe(true);
    expect(Array.from(session.owners).every((owner) => owner >= 0)).toBe(true);
    expect(session.solved).toBe(true);
    expect(callbacks.onSolved).toHaveBeenCalledTimes(1);
    expect(callbacks.onHint).not.toHaveBeenCalled();
  });

  it("starts the looping end-of-level glow once, over every path", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session, press, move, release } = makeSession(level);

    const draw = (path: number[]): void => {
      press(path[0]);
      for (let i = 1; i < path.length; i++) move(path[i]);
      release();
    };

    for (let color = 1; color < level.colors; color++) draw(level.solution[color]);
    expect(rendererState.celebrations).toHaveLength(0);

    draw(level.solution[0]);

    expect(session.solved).toBe(true);
    expect(rendererState.celebrations).toEqual([level.solution.map((path) => path.slice())]);
  });

  it("reports the solve once, not again when a linked path's last square is tapped", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session, callbacks, press, move, release } = makeSession(level);

    for (const path of level.solution) {
      press(path[0]);
      for (let i = 1; i < path.length; i++) move(path[i]);
      release();
    }
    expect(callbacks.onSolved).toHaveBeenCalledTimes(1);

    const path = level.solution[0];
    press(path[path.length - 1]);
    release();

    expect(session.solved).toBe(true);
    expect(callbacks.onSolved).toHaveBeenCalledTimes(1);
  });

  it("keeps colour laid down when the drag is released short of the target", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, move, release } = makeSession(level);

    press(path[0]);
    move(path[1]);
    move(path[2]);
    release();

    expect(session.paths[0]).toEqual(path.slice(0, 3));
    expect(session.owners[path[2]]).toBe(0);
    expect(session.complete[0]).toBe(false);
  });

  it("keeps the drag alive when it backs off the target square", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, move, release } = makeSession(level);
    const target = path[path.length - 1];
    const before = path[path.length - 2];

    press(path[0]);
    for (let i = 1; i < path.length; i++) move(path[i]);
    expect(session.paths[0]).toEqual(path);

    // Back off the target without releasing: the path truncates and must stay
    // free to grow again, or the pair can never be linked by this drag.
    move(before);
    expect(session.paths[0]).toEqual(path.slice(0, -1));
    expect(session.complete[0]).toBe(false);

    // Truncating further and growing again both still work.
    move(path[path.length - 3]);
    expect(session.paths[0]).toEqual(path.slice(0, -2));
    move(before);
    expect(session.paths[0]).toEqual(path.slice(0, -1));

    move(target);
    expect(session.paths[0]).toEqual(path);
    release();
    expect(session.complete[0]).toBe(true);
  });

  it("plays no completion glow for a path that came back short of its target", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, move, release } = makeSession(level);

    press(path[0]);
    for (let i = 1; i < path.length; i++) move(path[i]);
    move(path[path.length - 2]);
    release();

    expect(session.paths[0]).toEqual(path.slice(0, -1));
    expect(session.complete[0]).toBe(false);
    expect(rendererState.glows).toEqual([]);
  });

  it("truncates a path back to a square that is pressed again", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, move, release } = makeSession(level);

    press(path[0]);
    move(path[1]);
    move(path[2]);
    release();

    press(path[1]);
    release();

    expect(session.paths[0]).toEqual(path.slice(0, 2));
    expect(session.owners[path[2]]).toBe(-1);
    expect(session.owners[path[0]]).toBe(0);
    expect(session.owners[path[1]]).toBe(0);
  });

  it("extends an open path with a tap on the next grey square", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, release } = makeSession(level);

    press(path[0]);
    release();
    press(path[1]);
    release();

    expect(session.paths[0]).toEqual([path[0], path[1]]);
    expect(session.owners[path[1]]).toBe(0);
  });

  it("completes a pair when its target square is tapped next to the path head", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, callbacks, press, move, release } = makeSession(level);

    press(path[0]);
    for (let i = 1; i < path.length - 1; i++) move(path[i]);
    release();
    expect(session.complete[0]).toBe(false);

    press(path[path.length - 1]);
    release();

    expect(session.complete[0]).toBe(true);
    expect(callbacks.onSolved).not.toHaveBeenCalled();
  });

  it("leaves a path that stopped beside its endpoint for the player to finish", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const run = makeSession(level);

    for (let c = 1; c < level.colors; c++) tapAlong(run, level.solution[c]);
    // The last pair stops on the square in front of its far endpoint. That
    // endpoint already wears the pair's colour, so the board looks finished.
    const path = level.solution[0];
    tapAlong(run, path.slice(0, -1));

    // A full board must not close the pair on its own: the player may want the
    // path to run around that square instead of into it.
    expect(Array.from(run.session.owners).every((owner) => owner >= 0)).toBe(true);
    expect(run.session.paths[0]).toEqual(path.slice(0, -1));
    expect(run.session.complete[0]).toBe(false);
    expect(run.session.solved).toBe(false);
    expect(run.callbacks.onSolved).not.toHaveBeenCalled();
    expect(run.callbacks.onStuck).toHaveBeenCalledWith("unlinked");

    // Playing the endpoint square itself is what finishes the pair.
    run.press(path[path.length - 1]);
    run.release();
    expect(run.session.paths[0]).toEqual(path);
    expect(run.session.solved).toBe(true);
  });

  it("warns when a filled board still has a pair it cannot close", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const run = makeSession(level);
    const path = level.solution[0];
    // A prefix whose head is nowhere near the far endpoint: another colour took
    // the squares in between, so one tap can no longer join the pair.
    const prefix = path.slice(0, -2);
    expect(areAdjacent(level.layout, prefix[prefix.length - 1], level.endpoints[0][1])).toBe(false);

    run.session.owners.set(solvedColors(level));
    for (let c = 1; c < level.colors; c++) {
      run.session.paths[c] = level.solution[c].slice();
      run.session.complete[c] = true;
    }
    run.session.paths[0] = prefix.slice();

    // A drag beside the cube settles the board without touching it.
    run.canvas.emit("pointerdown", { clientX: 10, clientY: 10 });
    run.canvas.emit("pointerup");

    expect(run.session.paths[0]).toEqual(prefix);
    expect(run.session.solved).toBe(false);
    expect(run.callbacks.onSolved).not.toHaveBeenCalled();
    expect(run.callbacks.onStuck).toHaveBeenCalledWith("unlinked");
  });

  it("judges a filled board on the timer without waiting for a gesture", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const run = makeSession(level);
    const path = level.solution[0];

    run.session.owners.set(solvedColors(level));
    for (let c = 1; c < level.colors; c++) {
      run.session.paths[c] = level.solution[c].slice();
      run.session.complete[c] = true;
    }
    run.session.paths[0] = path.slice(0, -1);

    run.tick(0.2);
    expect(run.callbacks.onStuck).not.toHaveBeenCalled();

    run.tick(0.3);
    // The board is judged but not closed for the player: the path stays short.
    expect(run.session.paths[0]).toEqual(path.slice(0, -1));
    expect(run.callbacks.onSolved).not.toHaveBeenCalled();
    expect(run.callbacks.onStuck).toHaveBeenCalledWith("unlinked");
  });

  it("explains a tap on a grey square when no path can reach it", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const isolated = isolatedGreySquare(level);

    const first = makeSession(level);
    first.press(isolated);
    expect(first.callbacks.onHint).toHaveBeenCalledWith(
      "Tap a coloured square first, then a square next to it"
    );

    const second = makeSession(level);
    second.press(level.solution[0][0]);
    second.release();
    second.press(isolated);
    expect(second.callbacks.onHint).toHaveBeenCalledWith(
      "Tap a square next to the end of the path you are drawing"
    );
  });

  it("resets owners and paths to the initial state", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, press, move, release } = makeSession(level);

    press(path[0]);
    move(path[1]);
    release();
    expect(session.paths[0]).toHaveLength(2);

    session.reset();
    expect(Array.from(session.owners)).toEqual(Array.from(level.initial));
    expect(session.paths.every((entry) => entry.length === 0)).toBe(true);
    expect(session.complete.every((linked) => !linked)).toBe(true);
    expect(session.solved).toBe(false);
  });

  it("ignores extra pointers while a finger is already drawing", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { session, canvas, press, move, release } = makeSession(level);

    press(path[0]);
    move(path[1]);

    // A second finger lands on the path's start square and lifts again. It
    // must neither truncate the path nor end the first finger's drag.
    rendererState.pick = path[0];
    canvas.emit("pointerdown", { pointerId: 2, pointerType: "touch" });
    canvas.emit("pointerup", { pointerId: 2, pointerType: "touch" });

    expect(session.paths[0]).toEqual(path.slice(0, 2));

    move(path[2]);
    expect(session.paths[0]).toEqual(path.slice(0, 3));
    release();
  });

  it("turns the cube with a drag that starts on the empty space beside it", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session, canvas } = makeSession(level);

    canvas.emit("pointerdown", { clientX: 10, clientY: 10 });
    expect(canvas.style.cursor).toBe("grabbing");

    canvas.emit("pointermove", { clientX: 40, clientY: 25 });
    canvas.emit("pointermove", { clientX: 30, clientY: 5 });
    expect(rendererState.looks).toEqual([
      [30, 15],
      [-10, -20]
    ]);

    // A turn draws nothing.
    expect(session.paths.every((path) => path.length === 0)).toBe(true);
    expect(Array.from(session.owners)).toEqual(Array.from(level.initial));

    canvas.emit("pointerup");
    expect(rendererState.endedLooks).toBe(1);
    expect(canvas.style.cursor).toBe("default");
  });

  it("leaves the cube where it is on the press that starts a path", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { press, move, release } = makeSession(level);

    // Leaning on the press would slide the square out from under the finger and
    // start the path somewhere the player did not aim.
    press(path[0]);
    expect(rendererState.cursors).toEqual([]);

    // The lean follows the finger from its first move, with the path.
    move(path[1]);
    expect(rendererState.cursors).toEqual([[0, 0]]);
    release();
  });

  it("does not turn the cube when the drag starts on a square", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const path = level.solution[0];
    const { press, move, release } = makeSession(level);

    press(path[0]);
    move(path[1]);
    release();

    expect(rendererState.looks).toEqual([]);
  });

  it("ignores extra pointers while a turn is in progress", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { canvas } = makeSession(level);

    canvas.emit("pointerdown", { clientX: 0, clientY: 0 });
    canvas.emit("pointermove", { clientX: 20, clientY: 0 });
    const moved = rendererState.looks.slice();

    // A second finger lands and lifts; it must neither turn the cube nor end
    // the first finger's turn.
    canvas.emit("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 200 });
    canvas.emit("pointermove", { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 400 });
    canvas.emit("pointerup", { pointerId: 2, pointerType: "touch" });
    expect(rendererState.looks).toEqual(moved);

    canvas.emit("pointermove", { clientX: 25, clientY: 0 });
    expect(rendererState.looks).toEqual([...moved, [5, 0]]);
    canvas.emit("pointerup");
  });

  it("removes its listeners and destroys the renderer when disposed", () => {
    const level = generateLevel(LEVEL_CONFIGS[0], 12345);
    const { session, canvas } = makeSession(level);
    expect(canvas.listenerCount()).toBe(5);

    session.dispose();
    expect(canvas.listenerCount()).toBe(0);
    expect(rendererState.instance?.destroyed).toBe(true);

    expect(() => session.dispose()).not.toThrow();
  });
});
