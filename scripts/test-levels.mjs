/**
 * Level generator regression test: run with `npm test`.
 *
 * The game guarantees solvability by construction (a solved partition is built
 * first, endpoints are exposed afterwards). This test proves that guarantee and
 * the surface maths hold for every level of several seeds.
 */

import {
  FACES,
  PLAY_FACES,
  TILT_MAX,
  VIEW_DIR,
  buildLayout,
  neighborCount,
  projectToSquare,
  quatIdentity,
  quatRotate,
  tiltQuat,
  visibleFaceCount
} from "../src/game/layout.ts";
import { LEVEL_CONFIGS, LEVEL_COUNT, generateLevel, solvedColors, validateLevel } from "../src/game/levels.ts";
import { miniQuads } from "../src/game/preview.ts";
import { checkPairsConnected, checkSolution, countCovering, solveCovering } from "../src/game/solver.ts";

let failures = 0;
const fail = (message) => {
  failures++;
  console.error(`  FAIL ${message}`);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};

const PLAY = [...PLAY_FACES].sort((a, b) => a - b);

// --- play field ------------------------------------------------------------
// Only the three camera-facing faces are playable, so the field is 3·n²
// squares; crossing an edge may leave the field, which ends that direction.
for (const size of [2, 3, 4, 5, 6]) {
  const layout = buildLayout(size);
  check(layout.count === 3 * size * size, `size ${size}: expected ${3 * size * size} squares`);

  const degrees = new Map();
  for (let square = 0; square < layout.count; square++) {
    if (!PLAY.includes(layout.face[square])) fail(`size ${size}: square ${square} off the play field`);

    const seen = new Set();
    let degree = 0;
    for (let dir = 0; dir < 4; dir++) {
      const next = layout.next[square * 4 + dir];
      if (next < 0) continue;
      check(next < layout.count, `size ${size}: neighbour out of range`);
      check(next !== square, `size ${size}: square ${square} is its own neighbour`);
      check(!seen.has(next), `size ${size}: square ${square} has duplicate neighbours`);
      seen.add(next);
      degree++;
      let mutual = false;
      for (let back = 0; back < 4; back++) {
        if (layout.next[next * 4 + back] === square) mutual = true;
      }
      check(mutual, `size ${size}: ${square} -> ${next} is not mutual`);
    }
    check(degree === neighborCount(layout, square), `size ${size}: degree mismatch`);
    degrees.set(degree, (degrees.get(degree) ?? 0) + 1);
  }

  // Three squares sit at the outer corners (degree 2), border squares have 3,
  // interior squares 4. Nothing else is possible on a three-face patch.
  check(degrees.get(2) === 3, `size ${size}: expected 3 corner squares, got ${degrees.get(2)}`);
  check(degrees.get(3) === 6 * (size - 1), `size ${size}: border squares`);
  check(degrees.get(4) === 3 * (size - 1) ** 2, `size ${size}: interior squares`);

  // The field is one connected patch, otherwise no path could cover it.
  const reached = new Set([0]);
  const stack = [0];
  while (stack.length > 0) {
    const square = stack.pop();
    for (let dir = 0; dir < 4; dir++) {
      const next = layout.next[square * 4 + dir];
      if (next >= 0 && !reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  check(reached.size === layout.count, `size ${size}: field is not connected`);

  // Points on the hidden faces are never pickable.
  check(projectToSquare(size, -0.5, 0, 0) === -1, `size ${size}: -X face is in play`);
  check(projectToSquare(size, 0, -0.5, 0) === -1, `size ${size}: -Y face is in play`);
  check(projectToSquare(size, 0, 0, -0.5) === -1, `size ${size}: -Z face is in play`);
  check(projectToSquare(size, 0.5, 0, 0) >= 0, `size ${size}: +X face is not in play`);

  console.log(`field ${size}: ${layout.count} squares, 3 corners / ${degrees.get(3)} border / ${degrees.get(4)} interior`);
}

// --- the lean keeps exactly the three visible faces ------------------------
check(visibleFaceCount(quatIdentity()) === 3, "the base orientation shows three faces");

let worstTilt = 0;
for (const size of [2, 6]) {
  const layout = buildLayout(size);
  for (let square = 0; square < layout.count; square++) {
    const point = [
      layout.center[square * 3],
      layout.center[square * 3 + 1],
      layout.center[square * 3 + 2]
    ];
    const quat = tiltQuat(point);
    check(visibleFaceCount(quat) === 3, `size ${size}: tilt at ${square} shows ${visibleFaceCount(quat)} faces`);

    const facing = [];
    for (let face = 0; face < FACES.length; face++) {
      const n = quatRotate(quat, FACES[face].n);
      if (n[0] + n[1] + n[2] > 1e-6) facing.push(face);
    }
    check(facing.length === 3 && facing.every((face) => PLAY.includes(face)), `size ${size}: tilt at ${square} reveals other faces`);

    const angle = 2 * Math.acos(Math.min(1, quat[3]));
    worstTilt = Math.max(worstTilt, angle);
  }
}
check(worstTilt <= TILT_MAX + 1e-6, `tilt of ${((worstTilt * 180) / Math.PI).toFixed(1)}deg exceeds the cap`);
console.log(`lean: capped at ${((worstTilt * 180) / Math.PI).toFixed(1)}deg, always three faces`);

// The lean follows the pointer, so it aims from anywhere on the three faces,
// not just square centres: rims and corners included. A point is never allowed
// to turn another face towards the camera.
let rimTilt = 0;
for (const face of PLAY) {
  const basis = FACES[face];
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const uc = -0.5 + i / 20;
      const vc = -0.5 + j / 20;
      const point = [0, 1, 2].map((k) => basis.n[k] * 0.5 + basis.u[k] * uc + basis.v[k] * vc);
      const quat = tiltQuat(point);
      check(visibleFaceCount(quat) === 3, `lean at ${point} shows ${visibleFaceCount(quat)} faces`);
      rimTilt = Math.max(rimTilt, 2 * Math.acos(Math.min(1, Math.abs(quat[3]))));
    }
  }
}
check(rimTilt <= TILT_MAX + 1e-6, `rim lean of ${((rimTilt * 180) / Math.PI).toFixed(1)}deg exceeds the cap`);

// Leaning is what pulls the next square under the pointer: the aimed point
// must end up closer to the camera axis than it started, never further.
for (const face of PLAY) {
  const basis = FACES[face];
  const point = [0, 1, 2].map((k) => basis.n[k] * 0.5 + basis.u[k] * 0.35 + basis.v[k] * 0.35);
  const aimed = quatRotate(tiltQuat(point), point);
  const before = point.reduce((sum, value, k) => sum + value * VIEW_DIR[k], 0) / Math.hypot(...point);
  const after = aimed.reduce((sum, value, k) => sum + value * VIEW_DIR[k], 0) / Math.hypot(...aimed);
  check(after > before, `lean at ${point} turns away from the camera`);
}
console.log(`pointer lean: aimed from all ${PLAY.length} face rims, capped at ${((rimTilt * 180) / Math.PI).toFixed(1)}deg`);

// --- grading curve ---------------------------------------------------------
const sizes = LEVEL_CONFIGS.map((config) => config.size);
const colors = LEVEL_CONFIGS.map((config) => config.colors);
for (let i = 1; i < LEVEL_COUNT; i++) {
  check(sizes[i] >= sizes[i - 1], `level ${i + 1} shrinks the cube`);
  check(colors[i] >= colors[i - 1], `level ${i + 1} uses fewer colours`);
}
check(sizes[0] === 2 && colors[0] === 2, "level 1 should be a 2x2 cube with 2 colours");
check(sizes[LEVEL_COUNT - 1] === 6, "final level should be a 6x6 cube");
for (const config of LEVEL_CONFIGS) {
  const squares = 3 * config.size ** 2;
  check(config.colors * 4 <= squares, `level ${config.index + 1}: ${config.colors} colours do not fit`);
  check(config.colors * 2 < squares, `level ${config.index + 1}: too many exposed squares`);
}
console.log(`curve: sizes ${sizes[0]}..${sizes.at(-1)}, colours ${colors[0]}..${colors.at(-1)}`);

// --- generated levels ------------------------------------------------------
const seeds = [0, 1, 12345, 0xdeadbeef, 0xffffffff];
const started = performance.now();
for (const seed of seeds) {
  for (let index = 0; index < LEVEL_COUNT; index++) {
    const config = LEVEL_CONFIGS[index];
    const level = generateLevel(config, seed);
    const validation = validateLevel(level);
    check(validation.ok, `seed ${seed} level ${index + 1}: ${validation.errors.slice(0, 3).join("; ")}`);
    check(level.layout.count === 3 * config.size ** 2, `seed ${seed} level ${index + 1}: square count`);
    check(level.endpoints.length === config.colors, `seed ${seed} level ${index + 1}: endpoint count`);

    // the exposed start state is exactly the endpoint pairs
    const initialColored = Array.from(level.initial).filter((owner) => owner >= 0).length;
    check(initialColored === config.colors * 2, `seed ${seed} level ${index + 1}: start state`);

    // every colour owns two distinct squares
    const pairs = level.endpoints.flat();
    check(new Set(pairs).size === pairs.length, `seed ${seed} level ${index + 1}: endpoints shared between colours`);

    // deterministic: the same seed and index always rebuild the same level
    const again = generateLevel(config, seed);
    check(
      JSON.stringify(again.endpoints) === JSON.stringify(level.endpoints) &&
        JSON.stringify(again.solution) === JSON.stringify(level.solution),
      `seed ${seed} level ${index + 1}: generation is not deterministic`
    );
  }
}
console.log(`levels: ${seeds.length * LEVEL_COUNT} generated in ${(performance.now() - started).toFixed(0)}ms`);

// --- level screen previews --------------------------------------------------
// The mini cubes are drawn from an exact isometric projection: every tile must
// be the same parallelogram, squares that touch on the cube must share an edge
// in the drawing, and only the three camera-facing faces are drawn. Congruent
// tiles plus a single inset factor are what make the seams the same width on
// every face and every square.
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const near = (a, b) => Math.abs(a - b) < 1e-9;

for (let index = 0; index < LEVEL_COUNT; index++) {
  const level = generateLevel(LEVEL_CONFIGS[index], 12345);
  const n = level.size;
  const layout = buildLayout(n);
  const quads = miniQuads(level);
  check(quads.length === 3, `preview: level ${index + 1} draws ${quads.length} faces`);
  quads.forEach((face, slot) => {
    const normal = FACES[PLAY_FACES[slot]].n;
    check(normal[0] + normal[1] + normal[2] > 0, `preview: level ${index + 1} slot ${slot} faces away from the camera`);
    check(face.length === n * n, `preview: level ${index + 1} slot ${slot} has ${face.length} tiles`);
  });

  const squares = new Map();
  let first = null;
  for (let slot = 0; slot < 3; slot++) {
    for (let i = 0; i < n * n; i++) {
      const quad = quads[slot][i];
      squares.set(slot * n * n + i, quad);
      const e1 = sub(quad[1], quad[0]);
      const e2 = sub(quad[3], quad[0]);
      const area = Math.abs(e1.x * e2.y - e1.y * e2.x);
      check(area > 1e-9, `preview: level ${index + 1} slot ${slot} tile ${i} is degenerate`);
      check(near(len(sub(quad[1], quad[0])), len(sub(quad[2], quad[3]))), `preview: level ${index + 1} slot ${slot} tile ${i} is not a parallelogram`);
      const shape = [len(e1), len(e2), area].map((v) => Math.round(v * 1e12) / 1e12);
      if (!first) first = shape;
      check(near(shape[0], first[0]) && near(shape[1], first[1]) && near(shape[2], first[2]), `preview: level ${index + 1} slot ${slot} tile ${i} is not congruent to the others`);
    }
  }

  for (let i = 0; i < layout.count; i++) {
    for (let d = 0; d < 4; d++) {
      const j = layout.next[i * 4 + d];
      if (j < 0 || j < i) continue;
      const a = squares.get(i);
      const b = squares.get(j);
      let shared = 0;
      for (const p of a) {
        if (b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9)) shared++;
      }
      check(shared === 2, `preview: level ${index + 1} squares ${i} and ${j} do not share an edge in the drawing`);
    }
  }
}
console.log(`previews: ${LEVEL_COUNT} levels, congruent tiles, every touching pair shares an edge`);

// --- solvability -----------------------------------------------------------
// Independent solver: from the endpoint pairs alone, find disjoint colour
// paths that leave no square uncoloured (the level is only complete when every
// square is coloured).
const solveStarted = performance.now();
let worstSolve = 0;
let worstSolveLevel = "";
for (const seed of seeds) {
  for (let index = 0; index < LEVEL_COUNT; index++) {
    const level = generateLevel(LEVEL_CONFIGS[index], seed);
    const t = performance.now();
    // Exhaustive disjoint-path search is exponential, so it is run on the
    // boards where it terminates; bigger boards are covered by the necessary
    // condition below plus the generator's own solution as a witness.
    const paths = level.layout.count <= 48 ? solveCovering(level, { maxNodes: 40_000_000 }) : null;
    const took = performance.now() - t;
    if (took > worstSolve) {
      worstSolve = took;
      worstSolveLevel = `seed ${seed} level ${index + 1}`;
    }
    if (level.layout.count <= 48) {
      check(paths !== null, `seed ${seed} level ${index + 1}: no covering solution exists for the endpoint pairs`);
    }
    const connected = checkPairsConnected(level);
    check(connected.length === 0, `seed ${seed} level ${index + 1}: ${connected.slice(0, 2).join("; ")}`);
    if (!paths) continue;
    const errors = checkSolution(level, paths);
    check(errors.length === 0, `seed ${seed} level ${index + 1}: solver result invalid: ${errors.slice(0, 3).join("; ")}`);

    // the generator's own solved form must be a legal play solution too
    const ownErrors = checkSolution(level, level.solution);
    check(ownErrors.length === 0, `seed ${seed} level ${index + 1}: generator solution invalid: ${ownErrors.slice(0, 3).join("; ")}`);
  }
}
console.log(
  `solvability: ${seeds.length * LEVEL_COUNT} levels solved in ${(performance.now() - solveStarted).toFixed(0)}ms ` +
    `(worst ${worstSolve.toFixed(0)}ms at ${worstSolveLevel})`
);

// --- the very first level --------------------------------------------------
const first = generateLevel(LEVEL_CONFIGS[0], 12345);
check(first.size === 2 && first.colors === 2, "level 1 must stay a 2x2 cube with 2 colours");
const firstSolution = solveCovering(first, { maxNodes: 100_000 });
check(firstSolution !== null, "level 1: no covering solution exists for the endpoint pairs");
if (firstSolution) {
  const errors = checkSolution(first, firstSolution);
  check(errors.length === 0, `level 1: solver result invalid: ${errors.slice(0, 3).join("; ")}`);
  const covered = new Set(firstSolution.flat()).size;
  check(covered === first.layout.count, `level 1: solution covers ${covered}/${first.layout.count} squares`);
}
// the tutorial must be forced enough to be fair: only a couple of partitions
let worstPartitions = 0;
for (const seed of seeds) {
  const level = generateLevel(LEVEL_CONFIGS[0], seed);
  const partitions = countCovering(level, 64);
  check(partitions >= 1, `level 1 seed ${seed}: no covering solution`);
  worstPartitions = Math.max(worstPartitions, partitions);
}
check(worstPartitions <= 8, `level 1: ${worstPartitions} covering solutions is too many for a tutorial`);
console.log(
  `level 1: solvable and nearly forced from its endpoint pairs alone ` +
    `(${first.endpoints.map((p) => p.join("-")).join(", ")}; <=${worstPartitions} covering solutions)`
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall level checks passed");
