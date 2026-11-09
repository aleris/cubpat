import "./styles.css";
import { createGameApp } from "./game/app.ts";
import { LevelSession } from "./game/game.ts";
import { LEVEL_COUNT } from "./game/levels.ts";
import { isUnlocked, loadSave, recordCompletion } from "./progress.ts";
import { Screens } from "./ui/screens.ts";

const save = loadSave();
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (!canvas) throw new Error("#scene canvas missing");

const screens = new Screens(save.seed, {
  onPlay: (index) => navigate(index),
  onReset: () => session?.reset(),
  onMenu: () => navigate(null)
});

let session: LevelSession | null = null;
let hintedThisLevel = false;

const ready = createGameApp(canvas);

// ---------------------------------------------------------------------------
// Routing: `#/level/N` (1-based) is a level, anything else is the level menu.
// Hash URLs keep working under the relative build base, from any folder.

const MENU_URL = location.pathname + location.search;

/** Level index named by the URL, or null when it names none or a locked one. */
function routedLevel(): number | null {
  const match = /^#\/level\/(\d+)$/.exec(location.hash);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < LEVEL_COUNT && isUnlocked(save, index) ? index : null;
}

function route(): void {
  const index = routedLevel();
  if (index !== null) {
    void startLevel(index);
    return;
  }
  if (location.hash) history.replaceState(null, "", MENU_URL);
  showLevels();
}

function navigate(index: number | null): void {
  history.pushState(null, "", index === null ? MENU_URL : `#/level/${index + 1}`);
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

function showLevels(): void {
  session?.dispose();
  session = null;
  canvas!.classList.add("is-hidden");
  screens.showLevels(save);
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
  session?.dispose();
  const level = screens.levelFor(index);

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
  dismissBoot();
}

function handleSolved(index: number): void {
  recordCompletion(save, index);
  screens.refresh(save);
  screens.showSolved(index + 1 < LEVEL_COUNT ? index + 1 : -1);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && session) navigate(null);
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.classList.add("is-hidden");
route();

void ready.catch((error: unknown) => {
  console.error(error);
  screens.toast("This browser could not start WebGL2", 6000);
});
