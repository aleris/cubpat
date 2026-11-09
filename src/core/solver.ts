/**
 * Independent puzzle solver.
 *
 * Uses only what the player sees — the play field graph and the endpoint
 * pairs — never the generator's own solution. A level is solvable when this
 * returns a valid set of disjoint colour paths.
 *
 * Rules modelled (same as `LevelSession`):
 * - a colour path runs from one of its endpoints to the other,
 * - steps follow play-field adjacency,
 * - a square belongs to at most one colour,
 * - a colour never enters another colour's endpoint (those are pre-coloured),
 * - a level is only complete when every square is coloured.
 *
 * The covering search is exponential (it is Hamiltonian partitioning), so it is
 * meant for the small boards of the early levels; callers pass a node budget
 * and fall back to `checkPairsConnected` plus the generator's own solution.
 */

import type { Level } from "./level.ts";

export interface SolveOptions {
  /** Search node budget; pass 2 gives up and returns null above it. */
  maxNodes?: number;
}

/** One legal full-colour solution, or null when the budget runs out. */
export function solveCovering(level: Level, options: SolveOptions = {}): number[][] | null {
  const greedy = greedySolve(level);
  if (greedy) return greedy;
  return searchSolve(level, options.maxNodes ?? 500_000);
}

/** Every covering solution, up to `cap` (used to measure uniqueness). */
export function countCovering(level: Level, cap = 1000, maxNodes = 5_000_000): number {
  const { layout, colors, endpoints } = level;
  const owner = endpointOwners(level);
  const used = new Uint8Array(layout.count);
  const paths: number[][] = [];
  let count = 0;
  let nodes = 0;

  const assign = (color: number): void => {
    if (count >= cap || nodes > maxNodes) return;
    if (color === colors) {
      for (let i = 0; i < layout.count; i++) if (!used[i]) return;
      count++;
      return;
    }
    const [a, b] = endpoints[color];
    for (const [start, goal] of [[a, b], [b, a]]) {
      used[start] = 1;
      walk(color, start, goal, [start]);
      used[start] = 0;
      if (count >= cap || nodes > maxNodes) return;
    }
  };

  const walk = (color: number, head: number, goal: number, path: number[]): void => {
    if (count >= cap || nodes > maxNodes) return;
    if (head === goal) {
      paths[color] = path;
      assign(color + 1);
      paths[color] = [];
      return;
    }
    const base = head * 4;
    for (let d = 0; d < 4; d++) {
      const next = layout.next[base + d];
      if (next < 0 || used[next]) continue;
      if (owner[next] >= 0 && owner[next] !== color) continue;
      nodes++;
      used[next] = 1;
      path.push(next);
      walk(color, next, goal, path);
      path.pop();
      used[next] = 0;
    }
  };

  assign(0);
  return count;
}

/**
 * Necessary condition: each pair must be connectable on the field when only
 * other colours' endpoints are blocked. Returns one message per broken pair
 * (empty when every pair is connected).
 *
 * Always cheap (one BFS per colour), so it runs on every level even where the
 * exhaustive disjoint-paths search is out of reach.
 */
export function checkPairsConnected(level: Level): string[] {
  const owner = endpointOwners(level);
  const free = new Uint8Array(level.layout.count);
  const errors: string[] = [];
  for (let color = 0; color < level.colors; color++) {
    const [a, b] = level.endpoints[color];
    if (!shortestPath(level.layout, free, owner, color, a, b)) {
      errors.push(`colour ${color}: endpoints ${a} and ${b} are not connectable`);
    }
  }
  return errors;
}

/** Shortest available path per colour, in level order (must cover the field). */
function greedySolve(level: Level): number[][] | null {
  const { layout, colors, endpoints } = level;
  const owner = endpointOwners(level);
  const used = new Uint8Array(layout.count);
  const paths: number[][] = [];

  for (let color = 0; color < colors; color++) {
    const [a, b] = endpoints[color];
    let path: number[] | null = null;
    for (const [start, goal] of [[a, b], [b, a]]) {
      path = shortestPath(layout, used, owner, color, start, goal);
      if (path) break;
    }
    if (!path) return null;
    for (const square of path) used[square] = 1;
    paths.push(path);
  }
  for (let i = 0; i < layout.count; i++) if (!used[i]) return null;
  return paths;
}

function shortestPath(
  layout: Level["layout"],
  used: Uint8Array,
  owner: Int8Array,
  color: number,
  start: number,
  goal: number
): number[] | null {
  const previous = new Int32Array(layout.count).fill(-2);
  const queue: number[] = [start];
  previous[start] = -1;
  for (let q = 0; q < queue.length; q++) {
    const head = queue[q];
    if (head === goal) break;
    const base = head * 4;
    for (let d = 0; d < 4; d++) {
      const next = layout.next[base + d];
      if (next < 0 || previous[next] !== -2) continue;
      if (used[next]) continue;
      if (owner[next] >= 0 && owner[next] !== color) continue;
      previous[next] = head;
      queue.push(next);
    }
  }
  if (previous[goal] === -2) return null;
  const path = [goal];
  while (path[0] !== start) path.unshift(previous[path[0]]);
  return path;
}

/** Depth-first assignment with backtracking over whole paths. */
function searchSolve(level: Level, budget: number): number[][] | null {
  const { layout, colors, endpoints } = level;
  const owner = endpointOwners(level);
  const used = new Uint8Array(layout.count);
  const paths: number[][] = [];
  let nodes = 0;

  const assign = (color: number): boolean => {
    if (color === colors) {
      for (let i = 0; i < layout.count; i++) if (!used[i]) return false;
      return true;
    }
    const [a, b] = endpoints[color];
    return fromEndpoint(color, a, b) || fromEndpoint(color, b, a);
  };

  const fromEndpoint = (color: number, start: number, goal: number): boolean => {
    used[start] = 1;
    const path = [start];
    const done = walk(color, start, goal, path);
    used[start] = 0;
    return done;
  };

  const walk = (color: number, head: number, goal: number, path: number[]): boolean => {
    if (head === goal) {
      paths[color] = path.slice();
      if (assign(color + 1)) return true;
      paths.length = color;
      return false;
    }
    const base = head * 4;
    for (let d = 0; d < 4; d++) {
      const next = layout.next[base + d];
      if (next < 0 || used[next]) continue;
      if (owner[next] >= 0 && owner[next] !== color) continue;
      if (++nodes > budget) return false;
      used[next] = 1;
      path.push(next);
      if (walk(color, next, goal, path)) return true;
      path.pop();
      used[next] = 0;
      if (nodes > budget) return false;
    }
    return false;
  };

  return assign(0) ? paths : null;
}

function endpointOwners(level: Level): Int8Array {
  const owner = new Int8Array(level.layout.count).fill(-1);
  for (let c = 0; c < level.colors; c++) {
    for (const square of level.endpoints[c]) owner[square] = c;
  }
  return owner;
}

/** Structural check of a candidate solution against the game rules. */
export function checkSolution(level: Level, paths: number[][]): string[] {
  const errors: string[] = [];
  if (paths.length !== level.colors) errors.push(`expected ${level.colors} paths, got ${paths.length}`);
  const seen = new Int8Array(level.layout.count).fill(-1);
  const owners = endpointOwners(level);

  for (let c = 0; c < level.colors; c++) {
    const path = paths[c] ?? [];
    if (path.length < 2) {
      errors.push(`colour ${c}: path shorter than two squares`);
      continue;
    }
    const [a, b] = level.endpoints[c];
    const startsAtEndpoint = path[0] === a || path[0] === b;
    const endsAtOther =
      (path[0] === a && path[path.length - 1] === b) || (path[0] === b && path[path.length - 1] === a);
    if (!startsAtEndpoint) errors.push(`colour ${c}: path does not start on its endpoint`);
    if (!endsAtOther) errors.push(`colour ${c}: path does not run between its endpoints`);

    for (let i = 0; i < path.length; i++) {
      const square = path[i];
      if (seen[square] === c) errors.push(`colour ${c}: revisits square ${square}`);
      if (seen[square] >= 0 && seen[square] !== c) errors.push(`square ${square} used by two colours`);
      if (owners[square] >= 0 && owners[square] !== c) {
        errors.push(`colour ${c}: enters endpoint ${square} of colour ${owners[square]}`);
      }
      seen[square] = c;
      if (i > 0 && !isAdjacent(level, path[i - 1], square)) {
        errors.push(`colour ${c}: ${path[i - 1]} and ${square} are not adjacent`);
      }
    }
  }
  for (let i = 0; i < level.layout.count; i++) {
    if (seen[i] < 0) errors.push(`square ${i} left uncoloured`);
  }
  return errors;
}

function isAdjacent(level: Level, a: number, b: number): boolean {
  const base = a * 4;
  for (let d = 0; d < 4; d++) if (level.layout.next[base + d] === b) return true;
  return false;
}
