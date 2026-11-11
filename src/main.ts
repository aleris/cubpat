import "./styles.css";
import { LEVEL_COUNT, ZONES } from "./core/curve.ts";
import { LevelSession } from "./play/level-session.ts";
import { createGameApp } from "./render/scene.ts";
import { DEBUG_DEV_MODE_ON, isUnlocked, loadSave, recordCompletion } from "./state/progress.ts";
import { Screens } from "./ui/screens.ts";
import { decorateTitle } from "./ui/title.ts";

const save = loadSave();
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (!canvas) throw new Error("#scene canvas missing");

decorateTitle();

const screens = new Screens(save.seed, {
  onPlay: (index) => navigate(index),
  onZone: (zoneIndex) => navigateArea(zoneIndex),
  onZoneCleared: (zoneIndex) => navigateArea(zoneIndex, true),
  onReset: () => session?.reset(),
  onMenu: () => navigateArea(screens.area)
});

let session: LevelSession | null = null;
let hintedThisLevel = false;
/** Bumped per level start, so a superseded intro cannot start a level. */
let levelToken = 0;

const ready = createGameApp(canvas);

// ---------------------------------------------------------------------------
// Routing: `#/level/N` (1-based) is a level, `#/area/N` (1-based) is the
// level menu on that area tab, anything else is the level menu.
// Hash URLs keep working under the relative build base, from any folder.

const MENU_URL = location.pathname + location.search;

/** Level index named by the URL, or null when it names none or a locked one. */
function routedLevel(): number | null {
  const match = /^#\/level\/(\d+)$/.exec(location.hash);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < LEVEL_COUNT && isUnlocked(save, index) ? index : null;
}

/** Area index named by the URL, or null when it names none or a locked one. */
function routedArea(): number | null {
  const match = /^#\/area\/(\d+)$/.exec(location.hash);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < ZONES.length && isUnlocked(save, ZONES[index].from) ? index : null;
}

function route(): void {
  const index = routedLevel();
  if (index !== null) {
    void startLevel(index);
    return;
  }
  const area = routedArea();
  if (area !== null) {
    showLevels(area);
    return;
  }
  if (location.hash) history.replaceState(null, "", MENU_URL);
  showLevels();
}

function navigate(index: number): void {
  history.pushState(null, "", `#/level/${index + 1}`);
  route();
}

/** Area whose menu should animate in after the Next button finishes a zone. */
let pendingCelebration = -1;

function navigateArea(area: number, celebrate = false): void {
  pendingCelebration = celebrate ? area : -1;
  history.pushState(null, "", `#/area/${area + 1}`);
  route();
}

window.addEventListener("popstate", route);

/** Fades out the inline loader from index.html and reveals the page (idempotent). */
function dismissBoot(): void {
  const boot = document.getElementById("boot");
  if (!boot || boot.classList.contains("is-leaving")) return;
  document.documentElement.classList.remove("is-booting");
  boot.classList.add("is-leaving");
  // Matches the #boot opacity transition in index.html.
  setTimeout(() => boot.remove(), 400);
}

// ---------------------------------------------------------------------------

function showLevels(area?: number): void {
  session?.dispose();
  session = null;
  canvas!.classList.add("is-hidden");
  const celebrate = area !== undefined && area === pendingCelebration;
  pendingCelebration = -1;
  screens.showLevels(save, area, celebrate);
  dismissBoot();
}

async function startLevel(index: number): Promise<void> {
  const game = await ready.catch(() => null);
  if (!game) {
    history.replaceState(null, "", MENU_URL);
    showLevels();
    return;
  }
  // The URL may have moved on while the app was still starting.
  if (routedLevel() !== index) return;
  const { app, camera } = game;
  const level = screens.levelFor(index);
  const token = ++levelToken;

  // The cube stays hidden until the intro has finished fading out.
  // The boot loader hides every element but itself, so it must go first.
  dismissBoot();
  session?.dispose();
  session = null;
  canvas!.classList.add("is-hidden");
  const started = await screens.showIntro(level);
  if (!started || token !== levelToken || routedLevel() !== index) return;

  canvas!.classList.remove("is-hidden");
  screens.showGame(index);

  hintedThisLevel = false;
  session = new LevelSession(app, camera, canvas!, level, {
    onSolved: () => handleSolved(index),
    onAllLinked: () => {
      if (hintedThisLevel) return;
      hintedThisLevel = true;
      screens.toast("Every square needs a colour", 3200);
    },
    onHint: (message) => screens.toast(message, 3200)
  });

  if (index === 0 && !save.completed.includes(0)) {
    screens.toast("Tap or drag: fill the squares between two matching squares", 6000);
  }
}

function handleSolved(index: number): void {
  recordCompletion(save, index);
  screens.refresh(save);
  screens.showSolved(index + 1 < LEVEL_COUNT ? index + 1 : -1);
}

window.addEventListener("keydown", (event) => {
  if (
    DEBUG_DEV_MODE_ON &&
    event.code === "KeyS" &&
    event.metaKey &&
    event.altKey &&
    event.ctrlKey &&
    event.shiftKey
  ) {
    event.preventDefault();
    session?.solveNow();
    return;
  }
  if (event.key === "Escape" && (session || screens.introOpen)) navigateArea(screens.area);
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.classList.add("is-hidden");
route();

void ready.catch((error: unknown) => {
  console.error(error);
  screens.toast("This browser could not start WebGL2", 6000);
});
