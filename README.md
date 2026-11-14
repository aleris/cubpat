# Cubpat

A minimal colour-path puzzle on a Rubik-style cube, rendered with
[PlayCanvas 2](https://github.com/playcanvas/engine) on Vite 8 + TypeScript 7.

The cube starts grey except for pairs of coloured squares. Drag from a coloured
square across neighbouring squares to link each pair; a square belongs to one
path only, and the level is only complete when every square is coloured.

## Run

```bash
pnpm install
pnpm dev           # http://localhost:5173
pnpm build         # typecheck + production bundle in dist/
pnpm preview       # serve dist/
pnpm test          # Vitest unit suite (no browser needed)
```

## Install on a phone

The build is a home-screen web app. `public/manifest.webmanifest` plus the
`apple-mobile-web-app-*` metas in `index.html` make it launch without browser
chrome; `public/icons/` holds the 192/512/maskable PNGs and the 180 px Apple
touch icon.

- **iOS**: Safari → Share → Add to Home Screen. Only a home-screen launch runs
  without chrome — iOS has no fullscreen API for web pages, and it ignores the
  manifest's `display`, so the apple metas are what matter. `black-translucent`
  draws the page under the status bar and the home indicator; the HUD, the
  level menu and the level intro all add `env(safe-area-inset-top)` to their
  design padding, so the title clears the island instead of sliding under it.
- The page background is a single `--page-bg` in `src/styles.css`, painted on a
  fixed `body::before` layer that spans `100lvh`. Two iOS details shape it:
  iOS keeps the status bar as a strip outside the page and fills that strip with
  the first colour stop of the page background, so the gradient starts and ends
  on the base colour (`#07080c`) — a glow that reached the top edge met the
  strip on a hard line, which read as a band in a different shade of dark. And
  because iOS enlarges the visual viewport past the layout viewport when its
  browser bars collapse, a background on the root box could tile into the gap;
  the fixed layer covers every bar state.
- **Android / desktop Chrome**: the manifest supplies `display: "standalone"`,
  `start_url`, theme colours and icons for the install prompt.
- The icon artwork is `public/icons/icon.svg`; `icon-maskable.svg` is the same
  cube scaled to fit the 80% maskable safe zone. Re-rasterise them to 192 and
  512 px (plus 180 px for Apple) when changing the artwork.

## iOS simulator

No Xcode project is needed: Safari in the simulator runs the same WebKit engine
as the phone, so it is the cheapest place to check layout, safe areas, the page
background and WebGL. It shares the host's loopback, so a dev server bound to
`localhost` answers as `localhost` from inside it.

```bash
# list devices, then boot one by name (a UDID works too)
xcrun simctl list devices available
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl bootstatus booted -b        # wait until it is actually up

# dev server: a fixed port keeps the URL stable across restarts
pnpm dev -- --port 5199 --strictPort

# open a URL in the simulator's Safari
xcrun simctl openurl booted "http://localhost:5199/"
xcrun simctl openurl booted "http://localhost:5199/#/level/1"

# screenshot the screen (402x874 pt at 3x = 1206x2622 px), then inspect it
xcrun simctl io booted screenshot /tmp/cubpat.png

# stop it when done
xcrun simctl shutdown booted
```

- `open -a Simulator` shows the device UI and lets you tap; `openurl` and
  `screenshot` work without it.
- A URL that differs only in the hash does not reload the page; the app routes
  on `popstate`. When scripting a level, add a query string so the navigation
  is a real load: `...#/level/2` → `...?open=1#/level/2`.
- `DEBUG_DEV_MODE_ON` in `src/state/progress.ts` is `false`, so `#/level/N`
  falls back to the menu when level N is locked. Use level 1, or seed
  `localStorage["cubpat.save.v1"]` from Safari's Web Inspector.
- It does not reproduce a home-screen launch: Safari keeps a strip for the
  status bar and reports `env(safe-area-inset-top)` as `0`, while the installed
  app paints under the bars with the real insets. Verify anything that depends
  on those insets on a device.

## Rules

- **Link a pair.** Press a coloured square and drag to adjacent squares; each
  square the path enters takes that colour. Adjacency wraps around cube edges,
  so a path can cross faces.
- **Three faces only.** The camera sits on the `(1,1,1)` diagonal, so exactly
  three faces face it; those three are the whole play field and the other three
  are never shown or clickable. The cube leans up to 18 degrees. A mouse aims
  the lean at the pointer: the pointer's square becomes the most frontal part of
  the view and the squares around it slide towards the pointer, so reaching a
  neighbour costs roughly half the pointer travel. Off the cube the aim point
  stays on the nearest bit of surface and the lean fades with the distance past
  it, so the pointer keeps steering just outside the silhouette while a pointer
  far from the cube barely tips the view; crossing the edge never jumps. A
  finger has no hover, so it tips the cube by its travel from the press instead,
  reaching the full lean after about 60 CSS px: pressing moves nothing, a small
  move is a small tip, and the squares never jump out from under the finger. A
  lifted touch lets the cube stand upright. The cap stays well below the
  ~35 degrees that would bring another face into view, so the visible three never
  change.
- **Look around.** Pressing the empty space beside the cube and dragging turns
  it, so any of the three play faces can be brought nearly square-on: a
  horizontal drag swings the cube about the screen's vertical axis, a vertical
  drag tips it about the screen's horizontal one, following the pointer like a
  trackball. The turn stops at the largest step that keeps every play face at
  least 75 degrees from the view axis, so a hidden face never comes into view
  and no play face is left as a hairline sliver. Releasing turns the cube back
  to its rest angle. The pointer shows a grab cursor, and a grabbing one while
  turning, over the empty space.
- **Path markers.** While a colour has a path (being dragged or linked), the
  square it was started from shows a ▶ icon, its pair shows a ■ icon, and every
  two neighbouring squares of the path are joined by a 3D stitch: a half-torus
  tube in the colour of the tiles, arching out of the surface over the gap
  between them. A stitch ends a third of a tile width in from the tile edge
  facing its neighbour, and one that links squares across a cube edge lifts
  clear of both tiles and arches over the bevel. Starting from the other square
  of the pair swaps the icons. The icons lie flat on their square, aligned with
  the tile grid, with ▶ pointing along the grid direction closest to screen
  right.
- **Lifting keeps the path.** Release short of the second square and the colour
  stays on the board. Press any coloured square to pick the path up again; it
  truncates back to that square, then dragging continues from there. Pressing
  the square the path starts from clears the whole path.
- **Tap to fill.** A tap on a grey square that touches the open end of a path
  colours it with the colour touched last, so a path can be built by tapping one
  square after another. A tap on an empty square no path can reach shows an
  instruction at the bottom of the screen. Only one pointer drives the board:
  an extra finger or a resting palm is ignored until the first one lifts.
- **Backtracking.** Dragging back onto a square the path already covers removes
  the colour from that point forward.
- **Completion.** Reach the second square of the pair to link the colour (its
  squares light up one by one); tapping the second square does the same once the
  path reaches the square in front of it. A linked colour cannot grow any
  further; pressing one of its squares reopens it for editing. Because both
  endpoint squares are pre-coloured, a path that stops on the square in front of
  its far endpoint looks like a linked one; when the board is full that square is
  the only one left to take, so the pair links itself.
- **Level solved** when every pair is linked *and* every square is coloured. A
  full board is judged on release and again every 0.4 s, so a solve cannot be
  missed. A board that looks finished but is not gets one red, pulsing toast:
  "Every square must be filled with a color" when grey squares are left over,
  "All squares are filled, but a pair is still open — press that path and redraw
  it" when every square is coloured but a pair is short of its endpoint.
- **Reset** rebuilds the level, the **grid** button returns to the level screen.
  Solving a level reveals a wide `>>>` next-level button at the bottom centre,
  ringed by a slowly spinning rainbow border (cube stays fully visible and unblurred).

Progress and the master seed live in `localStorage` (`cubpat.save.v1`). The
level screen groups the 75 levels into three 25-level area tabs (Foundations,
Expansion, Mastery); each tab shows a 5×5 grid and the next level unlocks only
when the previous one is done. Areas not yet reached stay disabled, except when
`DEBUG_DEV_MODE_ON` unlocks every level; in that mode
`Cmd+Alt+Ctrl+Shift+S` solves the level in play, which makes the area-complete
transition easy to exercise (solve 1–24, then 25).
The open level is in the URL (`#/level/3`), and the active area tab is in the
URL (`#/area/2`), so a refresh keeps both. The browser's back/forward buttons
move between levels and area tabs. Locked, out-of-range or unknown URLs fall
back to the level screen.

Opening a level shows an intro over the page background before the cube: the
area name above the level's global number (26 is the first Expansion level), a
small all-grey cube followed by the cube size (`5×5`), and one small tile per
colour, painted with the same palette colour × procedural motif as the cube. It
fades in over ~0.9 s, then hands over on its own after 2 s; any click (or
Enter/Space) starts it early. The intro fades out over ~0.7 s and the cube view
appears once it is gone. The menu button is the only HUD control while the
intro is up. In play the top-left HUD shows the same global level number.

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

`src/core/curve.ts` holds three 25-level zones. Zone 1 ramps from 2×2 with
2 colours to 4×4 with 4; zone 2 opens with a 4×4 row and then moves to 5×5;
zone 3 opens with a 5×5 row and then moves to 6×6. Colours stop at 9, where the
palette and the tile motifs stay distinct. Each level also carries a variant —
`balanced`, `spread`, `mixed`, `clustered`, or `edge` — which reshapes endpoint
placement or run lengths without changing the cube size or colour count.

## Layout

```
src/main.ts              entry: hash routing, screens/level wiring
src/core/                puzzle domain, no DOM and no engine
  layout.ts              three-face surface graph, adjacency, square projection
  math.ts                vectors and quaternions over plain tuples
  view.ts                camera direction, pointer lean, inspection turn limits
  rng.ts                 seeded randomness
  palette.ts             hsl→hex and the generated level palette
  curve.ts               grading curve and level configs
  level.ts               seeded generation, solved state, validation
  solver.ts              independent solvability checks
  preview.ts             isometric projection: one quad per mini-cube tile
src/render/              PlayCanvas presentation
  scene.ts               engine bootstrap, isometric camera, lights
  cube-renderer.ts       tiles, materials, lean, drag turn, picking, glow
  meshes.ts              rounded body/tile and stitch meshes
  icon-atlas.ts          start/stop glyph atlas
src/play/
  level-session.ts       drag rules: extend, truncate, release, completion;
                         empty-space drags turn the cube
src/ui/
  screens.ts             area tabs, level grid (5×5 mini cubes), level intro,
                         HUD, solved dock, toast
  color-tiles.ts         level-intro colour strip (palette × tile motif)
  mini-cube.ts           mini cube canvases: level grid and intro size preview
src/state/
  progress.ts            localStorage save (seed + completed levels)
tests/                   Vitest suites, mirroring src/
  core/                  maths, palette, RNG, layout, view, curve, levels,
                         solver, mini-cube projection
  play/                  drag/tap session rules
  render/                procedural mesh geometry
  state/                 save persistence
vitest.config.ts         node environment, 60 s test timeout
```

## Verification

`pnpm test` runs the Vitest suite (Node only, no browser):

- vector and quaternion algebra, including rotation composition and length
  preservation;
- seeded randomness: FNV-1a hashing, replayable `mulberry32` streams, unsigned
  seeds, range guarantees and in-place shuffling;
- `hslToHex` conversion, hue wrapping and the golden-angle palette's distinct
  prefixes;
- the play field for sizes 2–6: `3·n²` squares, corner/border/interior degrees,
  connected, reciprocal neighbours, centre/outward projection round trips,
  hidden faces unpickable;
- the lean keeps exactly the three play faces visible and never exceeds its cap,
  aimed from every square centre and from the whole rim of the three faces
  (the pointer can now lean the cube from anywhere on its surface), and always
  turns the aimed point towards the camera;
- the inspection turn applies a fitting step whole, stops at the largest shorter
  step that keeps every play face above the facing floor, holds there under a
  continued drag but still turns back, and stays inside the floor through a long
  two-axis drag;
- the grading curve;
- 375 generated levels (75 levels × 5 seeds): full coverage, adjacency along
  every path, endpoint pairs distinct and exposed alone in the start state,
  per-level variant constraints, and deterministic regeneration from
  `(seed, index)`;
- **solvability**, with the independent solver in `src/core/solver.ts` that only
  sees the layout and the endpoint pairs: exact *covering* search (disjoint
  paths that leave no square grey) on every 3×3 board and the 4×4 five-colour
  boards, where the exponential search terminates, plus a BFS "each pair is
  connectable" necessary condition on every board. The generator's own solution is additionally validated
  against the *play* rules (endpoints, adjacency, no shared square, no entry
  into another colour's endpoint, full coverage).
- the tutorial level stays nearly forced: at most a handful of covering
  solutions for every seed.
- the level-screen mini cubes come from an exact isometric projection: every
  tile is the same rhombus and squares that touch on the cube share an edge in
  the drawing, so seams are evenly spaced and colour runs stay continuous across
  face edges. Each cube is drawn once into a canvas instead of a CSS 3D grid of
  elements, which used to round the tile gaps differently on every tile.
- session rules, driven through the real pointer handlers with a stubbed
  renderer: drag to extend, release short of the target, press-to-truncate,
  tap-to-grow, tap-to-link, extra-pointer isolation, hints for unreachable grey
  squares, turning the cube from an empty-space drag (and not from a square),
  reset, and listener/renderer disposal;
- procedural mesh geometry: quad vertex/normal/UV layout, stitch tube radius and
  winding, index offsets when appending, and degenerate inputs;
- save persistence: fresh saves, unsigned seed normalization, filtering
  malformed completed entries, corrupt/missing data fallback, completion
  dedupe/sort, and storage write failures.

The PlayCanvas renderer, scene bootstrap and DOM screens still need a browser;
those paths are covered by runtime smoke checks rather than this Node suite.
