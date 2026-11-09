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
 * Difficulty is graded by `curve.ts`: cube size and colour count both grow,
 * while the average path length shrinks (longer, easier snakes early on; short,
 * tangled ones later).
 */

import type { LevelConfig } from "./curve.ts";
import { areAdjacent, buildLayout, type CubeLayout } from "./layout.ts";
import { colorFor } from "./palette.ts";
import { mulberry32, seedForLevel, shuffleInPlace } from "./rng.ts";

/** A colour path must always have two endpoints plus at least two inner squares. */
const MIN_PATH = 4;

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
