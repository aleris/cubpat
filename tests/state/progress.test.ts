import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isUnlocked,
  loadSave,
  recordCompletion,
  type SaveData
} from "../../src/state/progress.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    }
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `loadSave` persists a fresh save, which reveals the storage key. */
function storageKey(): string {
  loadSave();
  const key = storage.key(0);
  if (key === null) throw new Error("expected a persisted save");
  return key;
}

describe("loadSave", () => {
  it("creates and persists a fresh save with an unsigned seed", () => {
    const save = loadSave();
    expect(save.completed).toEqual([]);
    expect(Number.isInteger(save.seed)).toBe(true);
    expect(save.seed).toBeGreaterThanOrEqual(0);
    expect(save.seed).toBeLessThan(2 ** 32);
    expect(storage.length).toBe(1);
    expect(JSON.parse(storage.getItem(storage.key(0)!)!)).toEqual(save);
  });

  it("loads a valid save, filtering malformed completed entries", () => {
    const key = storageKey();
    storage.setItem(
      key,
      JSON.stringify({ seed: 4294967297, completed: [2, 0, -1, 1.5, "3", 5] })
    );
    const save = loadSave();
    expect(save.seed).toBe(1);
    expect(save.completed).toEqual([2, 0, 5]);
  });

  it("falls back to a fresh save on malformed JSON", () => {
    const key = storageKey();
    storage.setItem(key, "{not json");
    const save = loadSave();
    expect(save.completed).toEqual([]);
    expect(Number.isInteger(save.seed)).toBe(true);
    expect(JSON.parse(storage.getItem(key)!)).toEqual(save);
  });

  it("falls back to a fresh save when the seed is missing or not finite", () => {
    const key = storageKey();
    for (const raw of [JSON.stringify({ completed: [1] }), JSON.stringify({ seed: "nope", completed: [] })]) {
      storage.setItem(key, raw);
      const save = loadSave();
      expect(save.seed).toBeGreaterThanOrEqual(0);
      expect(save.seed).toBeLessThan(2 ** 32);
      expect(save.completed).toEqual([]);
    }
  });
});

describe("recordCompletion", () => {
  it("inserts, sorts and dedupes completed levels", () => {
    const save = loadSave();
    const key = storageKey();
    recordCompletion(save, 2);
    recordCompletion(save, 0);
    recordCompletion(save, 2);

    expect(save.completed).toEqual([0, 2]);
    expect(JSON.parse(storage.getItem(key)!)).toEqual({ seed: save.seed, completed: [0, 2] });
  });

  it("persists a save that has not changed", () => {
    const save: SaveData = { seed: 42, completed: [3] };
    storage.setItem(storageKey(), JSON.stringify(save));
    recordCompletion(save, 3);
    expect(JSON.parse(storage.getItem(storage.key(0)!)!)).toEqual(save);
  });
});

describe("isUnlocked", () => {
  it("always leaves the first level playable", () => {
    const save = loadSave();
    expect(isUnlocked(save, 0)).toBe(true);
  });
});

describe("storage failures", () => {
  it("does not throw when the browser refuses writes", () => {
    storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };
    vi.stubGlobal("localStorage", storage);

    const save = loadSave();
    expect(save.completed).toEqual([]);
    expect(() => recordCompletion(save, 1)).not.toThrow();
  });
});
