/**
 * Level generation.
 *
 * A level is created from a solved state, never the other way around: the whole
 * cube surface is first partitioned into `colors` simple paths (a Hamiltonian
 * path over the surface graph, cut into contiguous runs). Every square belongs to
 * exactly one path, so the solved state colours every square. The playable level
 * then only exposes the two endpoint squares of each path; the generator's own
 * paths are a guaranteed solution, so every level is solvable by construction.
 *
 * Difficulty is graded by the hand tuned curve below: cube size and colour count
 * both grow, while the average path length shrinks (longer, easier snakes early
 * on; short, tangled ones later).
 */

import {
  areAdjacent,
  buildLayout,
  type CubeLayout
} from "./layout.ts";
import { mulberry32, seedForLevel, shuffleInPlace } from "./rng.ts";

export interface LevelConfig {
  index: number;
  size: number;
  colors: number;
}

/** Grading curve for the 25 levels: [cube size, colour count].
 *  Only three faces are in play (3·n² squares), so a level has 2·colors
 *  pre-coloured squares and colours·(3n²/colors) squares in the solution. */
const CURVE: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [2, 2],
  [3, 3],
  [3, 3],
  [3, 4],
  [4, 4],
  [4, 5],
  [4, 6],
  [4, 6],
  [5, 7],
  [5, 7],
  [5, 8],
  [5, 8],
  [5, 9],
  [6, 10],
  [6, 10],
  [6, 11],
  [6, 11],
  [6, 12],
  [6, 12],
  [6, 13],
  [6, 13],
  [6, 14],
  [6, 14],
  [6, 15]
];

export const LEVEL_COUNT = CURVE.length;

export const LEVEL_CONFIGS: LevelConfig[] = CURVE.map(([size, colors], i) => ({
  index: i,
  size,
  colors
}));

/** A colour path must always have two endpoints plus at least two inner squares. */
const MIN_PATH = 4;

// ---------------------------------------------------------------------------
// Palette: golden angle hues so any prefix stays visually distinct.
// ---------------------------------------------------------------------------

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number): string => {
    const n = Math.round(Math.min(1, Math.max(0, v + m)) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to(r)}${to(g)}${to(b)}`;
}

const PALETTE_SIZE = 20;
const PALETTE: string[] = Array.from({ length: PALETTE_SIZE }, (_, i) => {
  const hue = (i * 137.508 + 6) % 360;
  const lightness = i % 3 === 0 ? 0.58 : i % 3 === 1 ? 0.66 : 0.52;
  return hslToHex(hue, 0.83, lightness);
});

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE_SIZE];
}

// ---------------------------------------------------------------------------
// Solved state: Hamiltonian path + cuts
// ---------------------------------------------------------------------------

/**
 * Warnsdorff-ordered randomised DFS for a Hamiltonian path over the surface
 * graph. The surface is small (24..216 squares) and its vertex degrees are 4,
 * so this finds a path in a few hundred expansions with occasional backtracking.
 */
function hamiltonianPath(layout: CubeLayout, rng: () => number): number[] | null {
  const n = layout.count;
  const visited = new Uint8Array(n);
  const mark = new Int32Array(n);
  const stack = new Int32Array(n);
  const path = new Int32Array(n);
  const next = layout.next;
  let len = 0;
  let token = 0;
  let budget = 120_000;

  /** Cheap necessary conditions for the remaining unvisited set to still be
   *  walkable in one go: connected, no isolated square, at most two dead ends. */
  const viable = (v: number): boolean => {
    const remaining = n - len;
    if (remaining === 0) return true;
    // A single leftover square just has to be adjacent to the head, which the
    // neighbour scan below already guarantees.
    if (remaining === 1) return true;

    let first = -1;
    for (let d = 0; d < 4; d++) {
      const w = next[v * 4 + d];
      if (w >= 0 && !visited[w]) {
        first = w;
        break;
      }
    }
    if (first < 0) return false;

    token++;
    mark[first] = token;
    stack[0] = first;
    let top = 1;
    let reached = 1;
    let deadEnds = 0;
    while (top > 0) {
      const square = stack[--top];
      let degree = 0;
      for (let d = 0; d < 4; d++) {
        const w = next[square * 4 + d];
        if (w < 0 || visited[w]) continue;
        degree++;
        if (mark[w] !== token) {
          mark[w] = token;
          stack[top++] = w;
          reached++;
        }
      }
      if (degree === 0) return false;
      if (degree === 1) {
        deadEnds++;
        if (deadEnds > 2) return false;
      }
    }
    return reached === remaining;
  };

  const dfs = (v: number): boolean => {
    visited[v] = 1;
    path[len++] = v;
    if (len === n) return true;
    if (--budget <= 0 || !viable(v)) {
      visited[v] = 0;
      len--;
      return false;
    }

    const cands: number[] = [];
    const scores: number[] = [];
    for (let d = 0; d < 4; d++) {
      const w = next[v * 4 + d];
      if (w < 0 || visited[w]) continue;
      let degree = 0;
      for (let e = 0; e < 4; e++) {
        const x = next[w * 4 + e];
        if (x >= 0 && !visited[x]) degree++;
      }
      cands.push(w);
      scores.push(degree * 16 + Math.floor(rng() * 16));
    }
    const order = cands.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);

    for (const i of order) {
      if (dfs(cands[i])) return true;
      if (budget <= 0) break;
    }
    visited[v] = 0;
    len--;
    return false;
  };

  const starts: number[] = [];
  for (let i = 0; i < n; i++) starts.push(i);
  shuffleInPlace(rng, starts);

  for (let attempt = 0; attempt < 6; attempt++) {
    visited.fill(0);
    len = 0;
    if (dfs(starts[attempt % n])) return Array.from(path);
    if (budget <= 0) return null;
  }
  return null;
}

/** Cut a path into `colors` contiguous runs, each at least MIN_PATH long. */
function cutPath(path: number[], colors: number, rng: () => number): number[][] | null {
  const total = path.length;
  if (total < colors * MIN_PATH) return null;

  const lengths: number[] = [];
  let remaining = total;
  for (let i = 0; i < colors; i++) {
    const left = colors - i - 1;
    if (left === 0) {
      lengths.push(remaining);
      break;
    }
    const maxHere = remaining - left * MIN_PATH;
    const ideal = remaining / (colors - i);
    const jitter = 1 + (rng() * 2 - 1) * 0.28;
    const length = Math.min(maxHere, Math.max(MIN_PATH, Math.round(ideal * jitter)));
    lengths.push(length);
    remaining -= length;
  }

  const segments: number[][] = [];
  let at = 0;
  for (const length of lengths) {
    segments.push(path.slice(at, at + length));
    at += length;
  }
  return segments;
}

export interface Level {
  index: number;
  size: number;
  colors: number;
  layout: CubeLayout;
  /** per colour: the generator's own solution path */
  solution: number[][];
  /** per colour: [start, end] squares shown to the player */
  endpoints: Array<[number, number]>;
  /** per colour: css colour */
  palette: string[];
  /** per square: colour index or -1 when empty */
  initial: Int8Array;
}

export function generateLevel(config: LevelConfig, masterSeed: number): Level {
  const layout = buildLayout(config.size);
  for (let attempt = 0; attempt < 24; attempt++) {
    const rng = mulberry32(seedForLevel(masterSeed, config.index, attempt));
    const hamilton = hamiltonianPath(layout, rng);
    if (!hamilton) continue;

    const segments = cutPath(hamilton, config.colors, rng);
    if (!segments) continue;

    // Reject degenerate colours: a pair whose endpoints are direct neighbours
    // would already be "solved" from the first square onwards.
    let degenerate = false;
    for (const segment of segments) {
      if (areAdjacent(layout, segment[0], segment[segment.length - 1])) {
        degenerate = true;
        break;
      }
    }
    if (degenerate) continue;

    const colorOrder = shuffleInPlace(
      rng,
      Array.from({ length: config.colors }, (_, i) => i)
    );

    const solution: number[][] = new Array(config.colors);
    const endpoints: Array<[number, number]> = new Array(config.colors);
    const palette: string[] = new Array(config.colors);
    const initial = new Int8Array(layout.count).fill(-1);

    for (let slot = 0; slot < config.colors; slot++) {
      const color = colorOrder[slot];
      const segment = segments[slot];
      solution[color] = segment;
      endpoints[color] = [segment[0], segment[segment.length - 1]];
      palette[color] = colorFor(color);
      initial[segment[0]] = color;
      initial[segment[segment.length - 1]] = color;
    }

    return {
      index: config.index,
      size: config.size,
      colors: config.colors,
      layout,
      solution,
      endpoints,
      palette,
      initial
    };
  }
  throw new Error(`level ${config.index} generation failed`);
}

/** Colour of every square in the solved state. */
export function solvedColors(level: Level): Int8Array {
  const out = new Int8Array(level.layout.count).fill(-1);
  for (let c = 0; c < level.colors; c++) {
    for (const sq of level.solution[c]) out[sq] = c;
  }
  return out;
}

export interface LevelValidation {
  ok: boolean;
  errors: string[];
}

/** Structural check used by the test harness: identity is guaranteed by
 *  construction, this proves it holds for a concrete seed. */
export function validateLevel(level: Level): LevelValidation {
  const errors: string[] = [];
  const { layout } = level;
  const seen = new Int8Array(layout.count).fill(-1);

  if (level.solution.length !== level.colors) errors.push("solution length");
  if (level.palette.length !== level.colors) errors.push("palette length");

  for (let c = 0; c < level.colors; c++) {
    const path = level.solution[c];
    if (path.length < MIN_PATH) errors.push(`colour ${c}: path too short`);
    for (let i = 0; i < path.length; i++) {
      const sq = path[i];
      if (seen[sq] !== -1) errors.push(`square ${sq} covered twice`);
      seen[sq] = c;
      if (i > 0 && !areAdjacent(layout, path[i - 1], sq)) {
        errors.push(`colour ${c}: break between ${path[i - 1]} and ${sq}`);
      }
    }
    const [a, b] = level.endpoints[c];
    if (a !== path[0] || b !== path[path.length - 1]) errors.push(`colour ${c}: endpoints`);
    if (level.initial[a] !== c || level.initial[b] !== c) errors.push(`colour ${c}: initial pair`);
  }

  for (let i = 0; i < layout.count; i++) {
    if (seen[i] === -1) errors.push(`square ${i} uncoloured`);
  }

  return { ok: errors.length === 0, errors };
}
