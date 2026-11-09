import { describe, expect, it, vi } from "vitest";
import { LEVEL_CONFIGS } from "../../src/core/curve.ts";
import { areAdjacent } from "../../src/core/layout.ts";
import { generateLevel, type Level } from "../../src/core/level.ts";
import { LevelSession } from "../../src/play/level-session.ts";

const rendererState = vi.hoisted(() => ({
  instance: null as null | { destroyed: boolean },
  pick: null as number | null
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

    setCursor(): void {}
    setHover(): void {}
    setHead(): void {}
    setBoard(): void {}
    clearCursor(): void {}
    stopGlow(): void {}

    playPathGlow(_color: number, _path: number[], done?: () => void): void {
      done?.();
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

function makeSession(level: Level) {
  const callbacks = { onSolved: vi.fn(), onAllLinked: vi.fn(), onHint: vi.fn() };
  const canvas = new FakeCanvas();
  const app = { on: vi.fn(), off: vi.fn() };
  const session = new LevelSession(
    app as never,
    {} as never,
    canvas as unknown as HTMLCanvasElement,
    level,
    callbacks
  );
  rendererState.pick = null;

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
  return { session, callbacks, canvas, press, move, release };
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
