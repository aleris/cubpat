/** Browser persisted progress. The master seed lives here too: every level is a
 *  pure function of (seed, level index), so a saved seed replays the same run. */

const KEY = "cubpat.save.v1";
export const DEBUG_DEV_MODE_ON = false;

export interface SaveData {
  seed: number;
  completed: number[];
}

function persist(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode / quota: progress simply does not survive the session */
  }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (typeof parsed.seed === "number" && Number.isFinite(parsed.seed)) {
        const completed = Array.isArray(parsed.completed)
          ? parsed.completed.filter((n): n is number => Number.isInteger(n) && n >= 0)
          : [];
        return { seed: parsed.seed >>> 0, completed };
      }
    }
  } catch {
    /* fall through to a fresh save */
  }
  const fresh: SaveData = { seed: (Math.random() * 0xffffffff) >>> 0, completed: [] };
  persist(fresh);
  return fresh;
}

export function recordCompletion(save: SaveData, levelIndex: number): void {
  if (!save.completed.includes(levelIndex)) {
    save.completed.push(levelIndex);
    save.completed.sort((a, b) => a - b);
  }
  persist(save);
}

export function isUnlocked(save: SaveData, levelIndex: number): boolean {
  if (DEBUG_DEV_MODE_ON) return true;
  if (levelIndex === 0) return true;
  return save.completed.includes(levelIndex) || save.completed.includes(levelIndex - 1);
}
