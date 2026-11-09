# cubpat agent notes

Vite 8 + TypeScript + PlayCanvas 2. The runtime is browser-only, but the puzzle
domain under `src/core/` is plain TypeScript and runs directly in Node.

## The short version

1. Run `npm test` and `npm run build` first. They need no browser.
2. Use one-shot headless Chrome **only for the level-select screen** (`/`).
3. Use a persistent headless Chrome + the DevTools Protocol for anything in a
   level: screenshots, hover/lean, drags, taps, renderer state.
4. Do **not** install Playwright. It is not a project dependency, the cached
   browser build usually mismatches, and the ~50-line CDP client below is faster
   and has no install step.
5. Do **not** use `gl.readPixels` to inspect the scene. PlayCanvas renders into
   its own framebuffer with `preserveDrawingBuffer: false`; screenshot instead.
6. Use `http://localhost:<port>`, never `http://127.0.0.1:<port>`. Vite binds
   IPv6 `::1` by default; the 127 address refuses the connection and also makes
   service readiness probes time out while the server is actually up.

## Start the app

Keep a dev server and a Chrome instance alive for the whole debugging session.
Restarting them per check wastes more time than any single fix.

```bash
# pick a free port; 5173 is often already occupied
npm run dev -- --port 5199 --strictPort
# or, for the production bundle:
npm run build && npx vite preview --port 4173 --strictPort
```

Check reachability with the hostname Vite printed:

```bash
curl -sI http://localhost:5199/ | head -1
```

## Lane 1: non-browser checks

The core modules import in Node 24 without a build step:

```bash
node -e 'import("./src/core/layout.ts").then(m => console.log(m.buildLayout(3).count))'
```

Use this for layout, generation, solver, palette, projection, and mesh-data
invariants. `scripts/test-levels.mjs` is the existing regression suite
(`npm test`); it is the cheapest way to catch generator or geometry breakage.

`src/render/meshes.ts` also runs in Node for CPU-side mesh audits (winding,
watertight edges, normals, signed volume). Only code that touches a
`pc.GraphicsDevice` needs a browser.

## Lane 2: one-shot screenshot (menu only)

The level-select screen is static DOM plus 2D canvases and screenshots reliably:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --no-sandbox \
  --user-data-dir=/tmp/cubpat-shot \
  --enable-unsafe-swiftshader --hide-scrollbars \
  --window-size=1200,900 --virtual-time-budget=10000 \
  --screenshot=/tmp/cubpat-menu.png \
  "http://localhost:5199/"
```

Then inspect it with `read /tmp/cubpat-menu.png`.

`--user-data-dir` keeps the run isolated from a real Chrome profile. Delete the
profile when changing flags; otherwise a stale singleton can ignore them.

**Do not use this for `#/level/N`.** The cube has a 1.5 s intro driven by the
PlayCanvas update loop. `--virtual-time-budget` does not reliably advance that
loop before capture: the screenshot often catches an early frame where the cube
is tiny and dark. That is an instrument artifact, not a rendering bug. Use CDP
below for level visuals.

Flags that matter:

- `--enable-unsafe-swiftshader` and `--use-angle=swiftshader`: software WebGL.
- `--disable-gpu`: removes WebGL entirely; do not add it.
- `CVDisplayLinkCreateWithCGDisplay failed ... -6670` on macOS is harmless noise.

## Lane 3: persistent Chrome + CDP (primary for levels)

Start Chrome once, as a long-lived background process/service:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
rm -rf /tmp/cubpat-cdp
"$CHROME" --headless=new --no-sandbox \
  --remote-debugging-port=9333 \
  --user-data-dir=/tmp/cubpat-cdp \
  --window-size=1200,900 --hide-scrollbars \
  --use-angle=swiftshader --enable-unsafe-swiftshader \
  --no-first-run --no-default-browser-check \
  "http://localhost:5199/#/level/1"
```

Wait for `DevTools listening` on port 9333. If the port is already held by an
older Chrome, use 9334 and a different `--user-data-dir`; do not kill an
unrelated browser.

Node 24 has a global `WebSocket`, so no dependencies are needed. A reusable
client (put it in `/tmp`, never in the repo):

```js
// /tmp/cdp.mjs
const PORT = Number(process.env.PORT ?? 9333);
const URL = process.env.URL ?? "http://localhost:5199/#/level/1";
const OUT = process.env.OUT ?? "/tmp/cubpat.png";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page =
  list.find((t) => t.type === "page" && t.url.includes("localhost")) ??
  list.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const frame = () =>
  evaluate(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))"
  );

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });
await new Promise((resolve) => setTimeout(resolve, 2000)); // let the intro finish
await frame();

const { writeFileSync } = await import("node:fs");
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log(OUT);
ws.close();
```

Run `node /tmp/cdp.mjs`, then `read /tmp/cubpat.png`.

After any state mutation, wait at least two `requestAnimationFrame`s before
capturing. The cube lean has a 0.08 s time constant, so add ~200 ms for hover
changes and ~350 ms after a tap/drag.

For pixel-level inspection, crop instead of guessing:

```bash
sips -g pixelWidth -g pixelHeight /tmp/cubpat.png
python3 - <<'PY'
from PIL import Image
img = Image.open("/tmp/cubpat.png")
img.crop((150, 90, 1050, 810)).resize((1350, 1080), Image.LANCZOS).save("/tmp/zoom.png")
PY
```

`python3` on the host has PIL; `numpy` is not available in the eval runtime.

## Reading game state

The session object is local to `startLevel()` in `src/main.ts`. To inspect or
seed it, add a temporary hook after the `new LevelSession(...)` call:

```ts
(globalThis as Record<string, unknown>).__cubpat = session;
```

Then use `Runtime.evaluate`:

```js
const s = globalThis.__cubpat;
({
  size: s.level.size,
  colors: s.level.colors,
  owners: [...s.owners],
  paths: s.paths,
  complete: s.complete,
  solved: s.solved
});
```

The hook exposes `level` (including `level.solution` and `level.initial`),
`owners`, `paths`, `complete`, and `renderer`. The renderer exposes `layout`,
`camera`, `root`, `canvas`, `setBoard()`, and `pick()`, plus the runtime-private
`rebuildMarkers()` and `pushStitch()`.

**Remove the hook before yielding.** A stray `__cubpat` line previously reached
a commit; check `git diff` / `git status` for it.

Without editing source you can still reach PlayCanvas itself, but not the
session. Read the Vite-served import in `scene.ts` and use the exact hashed URL:

```bash
curl -s http://localhost:5199/src/render/scene.ts | head -1
# import * as pc from "/node_modules/.vite/deps/playcanvas.js?v=HASH";
```

```js
const pc = await import("/node_modules/.vite/deps/playcanvas.js?v=HASH");
const app = pc.AppBase.getApplication(); // undefined if the ?v= hash is wrong
```

The hash changes when Vite restarts; always re-read it.

## Seeding a specific level

Save data lives in `localStorage["cubpat.save.v1"]`:

```js
localStorage.setItem(
  "cubpat.save.v1",
  JSON.stringify({ seed: 2024, completed: Array.from({ length: 75 }, (_, i) => i) })
);
location.hash = "#/level/75";
```

Levels are 1-based in the hash. `DEBUG_DEV_MODE_ON` in
`src/state/progress.ts` is currently `true`, so every level is unlocked and a
direct `#/level/N` works. If it is ever set to `false`, seed `completed` first
and call `Page.reload({ ignoreCache: true })`.

One-shot `--screenshot` cannot inject JavaScript before capture; the page's own
scripts run, but there is no init script. Use CDP when state must be seeded
first. Do not route a level screenshot through a throwaway `inject.html`: the
intro-frame problem above still applies.

## Forcing a visual state

To render the solved board without playing it:

```js
const s = globalThis.__cubpat;
s.owners.fill(-1);
s.owners.set(s.level.initial);
for (let c = 0; c < s.level.colors; c++) {
  const path = s.level.solution[c].slice(0, -1);
  s.paths[c] = path;
  for (const sq of path) s.owners[sq] = c;
}
s.renderer.setBoard(s.owners, s.paths);
await frame();
```

For marker/stitch checks, prefill the board, then monkey-patch the renderer
prototype to capture the `MeshData` passed to `pushStitch`/`pushHalfTorus`.
Always call through to the original method, or the mesh renders empty; always
restore the prototype afterwards.

## Driving real input

The cube leans toward the pointer, so a tile's screen position changes between
events. Re-project before every event instead of reusing a coordinate.

```js
const s = globalThis.__cubpat;
const r = s.renderer;
const scene = await (await fetch("/src/render/scene.ts")).text();
const pcUrl = scene.match(/playcanvas\.js\?v=[a-f0-9]+/)[0];
const pc = await import("/node_modules/.vite/deps/" + pcUrl);

const square = 3;
const c = s.level.layout.center;
const local = new pc.Vec3(c[square * 3], c[square * 3 + 1], c[square * 3 + 2]);
const world = r.root.getWorldTransform().transformPoint(local);
const screen = r.camera.camera.worldToScreen(world);
const rect = r.canvas.getBoundingClientRect();
const x = rect.left + (screen.x / r.canvas.width) * rect.width;
const y = rect.top + (screen.y / r.canvas.height) * rect.height;
```

Then dispatch:

```js
await send("Input.dispatchMouseEvent", {
  type: "mouseMoved", x, y, button: "none", buttons: 0
});
await send("Input.dispatchMouseEvent", {
  type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1
});
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1
});
```

For a drag, keep `buttons: 1` and send several `mouseMoved` events, re-projecting
the next tile each time, then release. Verify the result by reading
`__cubpat.paths`/`owners` and taking a screenshot after two frames.

## Gotchas

- `--virtual-time-budget` is not a general "wait for the app" flag. It is fine
  for the static menu; it captures arbitrary intro frames in a level.
- `readPixels` returns zeros/INVALID_OPERATION because PlayCanvas leaves its own
  framebuffer bound and the context has `preserveDrawingBuffer: false`.
- `mesh.getPositions()` throws; mesh data is GPU-only. Capture the CPU-side
  `MeshData` by wrapping `pushStitch`/`pushHalfTorus`, or assert on the generator.
- The canvas fills the window (`FILLMODE_FILL_WINDOW`, `RESOLUTION_AUTO`), so
  CSS pixels and backing-store pixels differ. Convert through
  `rect.width / canvas.width`.
- `Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 3` is the cheap
  zoom lens for judging bevels, stitch feet, and icon placement.
- PlayCanvas module identity matters: a bare `import("playcanvas")` in
  `Runtime.evaluate` is not the module the app loaded. Use the hashed Vite URL.
- Vite HMR can leave the page on old code after a restart. Reload explicitly
  with `Page.reload({ ignoreCache: true })` when a change does not appear.

## Definition of verified

A visual or interaction change is verified when all of these have run:

1. `npm test`
2. `npm run build`
3. CDP screenshot of the level-select screen and the affected level, viewed with
   `read`
4. for interaction changes: real `Input.dispatchMouseEvent` input, state read
   back from `__cubpat`, and a post-frame screenshot
5. `__cubpat` and any `/tmp` scripts removed; `git diff` contains only the
   intended source changes
