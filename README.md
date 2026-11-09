# Cubpat

A minimal colour-path puzzle on a Rubik-style cube, rendered with
[PlayCanvas 2](https://github.com/playcanvas/engine) on Vite 8 + TypeScript 7.

The cube starts grey except for pairs of coloured squares. Drag from a coloured
square across neighbouring squares to link each pair; a square belongs to one
path only, and the level is only complete when every square is coloured.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve dist/
npm test           # level generator invariants (no browser needed)
```

## Rules

- **Link a pair.** Press a coloured square and drag to adjacent squares; each
  square the path enters takes that colour. Adjacency wraps around cube edges,
  so a path can cross faces.
- **Three faces only.** The camera sits on the `(1,1,1)` diagonal, so exactly
  three faces face it; those three are the whole play field and the other three
  are never shown or clickable. The cube leans towards whatever the pointer is
  over, up to 18 degrees, continuously on every pointer move rather than only
  when the square under it changes: the touched square becomes the most frontal
  part of the view and the squares around it slide towards the pointer, so
  reaching a neighbour costs roughly half the pointer travel. Off the cube the
  aim point stays on the nearest bit of surface and the lean fades with the
  distance past it, so the pointer keeps steering just outside the silhouette
  while a pointer far from the cube barely tips the view; crossing the edge never
  jumps. A lifted touch lets the cube stand upright. The cap stays well below the
  ~35 degrees that would bring another face into view, so the visible three never
  change.
- **Path markers.** While a colour has a path (being dragged or linked), the
  square it was started from shows a ▶ icon, its pair shows a ■ icon, and a
  dashed line runs through the centres of the path's squares, folding over cube
  edges. Starting from the other square of the pair swaps the icons. The icons
  lie flat on their square, aligned with the tile grid, with ▶ pointing along
  the grid direction closest to screen right.
- **Lifting keeps the path.** Release short of the second square and the colour
  stays on the board. Press any coloured square to pick the path up again; it
  truncates back to that square, then dragging continues from there. Pressing
  the square the path starts from clears the whole path.
- **Tap to fill.** A tap on a grey square that touches the open end of a path
  colours it with the colour touched last, so a path can be built by tapping one
  square after another. A tap on an empty square no path can reach shows an
  instruction at the bottom of the screen.
- **Backtracking.** Dragging back onto a square the path already covers removes
  the colour from that point forward.
- **Completion.** Reach the second square of the pair to link the colour (its
  squares light up one by one); tapping the second square does the same once the
  path reaches the square in front of it. A linked colour cannot grow any
  further; pressing one of its squares reopens it for editing.
- **Level solved** when every pair is linked *and* every square is coloured;
  linking the last pair with grey left over shows "Every square needs a colour".
- **Reset** rebuilds the level, the **grid** button returns to the level screen.
  Solving a level reveals a next-level arrow near the top centre, ringed by a
  slowly spinning rainbow border (cube stays fully visible and unblurred).

Progress and the master seed live in `localStorage` (`cubpat.save.v1`). The
level grid is 5×5; the next level unlocks only when the previous one is done.
The open level is in the URL (`#/level/3`), so a refresh restarts the same level
and the browser's back/forward buttons move between a level and the level screen.
Locked, out-of-range or unknown URLs fall back to the level screen.

## Level generation

Levels are a pure function of `(seed, level index)`, so a saved seed replays the
same run.

1. Build the play field: the three camera-facing faces, `3·n²` squares with up
   to four neighbours each. Neighbours are found by stepping one square width
   from a square centre and projecting the point onto the cube
   (`projectToSquare`), which makes edge wrapping fall out of the maths — a step
   that leaves the three faces simply ends the field there.
2. Find a Hamiltonian path over the field with a randomised, Warnsdorff-ordered
   DFS, pruned by "the unvisited region must stay connected, have no isolated
   square and at most two dead ends". This is the *solved* state, so it is
   guaranteed to colour every square in play.
3. Cut the path into `colors` contiguous runs of at least four squares. Each run
   is one colour, and its two ends are the pair the player has to reconnect.
   Because the runs are a partition of the field, the generator itself is a
   witness that the puzzle is solvable (each run is a legal player path, runs
   never overlap and never enter another colour's endpoints); degenerate pairs
   (endpoints already touching) are rejected and the seed is re-derived.
4. Only the two endpoints of each run are coloured in the start state; the rest
   is grey.

`src/game/levels.ts` holds the grading curve — cube size and colour count both
grow while the average path length shrinks (2×2 with 2 colours at level 1 up to
6×6 with 15 colours at level 25).

## Layout

```
src/game/layout.ts     three-face surface graph, lean quaternions
src/game/levels.ts     seeded generation, grading curve, palette, validation
src/game/cube-view.ts  PlayCanvas scene: tiles, materials, rotations, picking, glow
src/game/game.ts       drag rules: extend, truncate, release, completion
src/game/preview.ts    level-screen mini cube: isometric projection, one quad per tile
src/game/app.ts        engine bootstrap, isometric camera, lights
src/ui/screens.ts      level grid (5×5 mini cubes), HUD, solved dock
src/progress.ts        localStorage save (seed + completed levels)
```

## Verification

`npm test` (Node only, no browser) checks:

- the play field for sizes 2–6: `3·n²` squares, corner/border/interior degrees,
  connected, hidden faces unpickable;
- the lean keeps exactly the three play faces visible and never exceeds its cap,
  aimed from every square centre and from the whole rim of the three faces
  (the pointer can now lean the cube from anywhere on its surface), and always
  turns the aimed point towards the camera;
- the grading curve;
- 125 generated levels (25 levels × 5 seeds): full coverage, adjacency along
  every path, endpoint pairs distinct and exposed alone in the start state, and
  deterministic regeneration from `(seed, index)`;
- **solvability**, with the independent solver in `src/game/solver.ts` that only
  sees the layout and the endpoint pairs: exact *covering* search (disjoint
  paths that leave no square grey) on boards up to 4×4, where the exponential
  search terminates, plus a BFS "each pair is connectable" necessary condition
  on every board. The generator's own solution is additionally validated
  against the *play* rules (endpoints, adjacency, no shared square, no entry
  into another colour's endpoint, full coverage).
- the tutorial level stays nearly forced: at most a handful of covering
  solutions for every seed.
- the level-screen mini cubes come from an exact isometric projection: every
  tile is the same rhombus and squares that touch on the cube share an edge in
  the drawing, so seams are evenly spaced and colour runs stay continuous across
  face edges. Each cube is drawn once into a canvas instead of a CSS 3D grid of
  elements, which used to round the tile gaps differently on every tile.
