import { LEVEL_COUNT, LEVEL_CONFIGS, generateLevel, solvedColors, type Level } from "../game/levels.ts";
import { miniQuads, type Quad } from "../game/preview.ts";
import { isUnlocked, type SaveData } from "../progress.ts";

export interface ScreenHooks {
  onPlay: (levelIndex: number) => void;
  onReset: () => void;
  onMenu: () => void;
}

/** Internal canvas resolution; CSS scales it down, so edges stay crisp. */
const MINI_RES = 192;
/** Fraction of each tile kept when insetting it: the seam width is uniform. */
const MINI_TILE = 0.88;
const MINI_BODY = "#05060a";
const MINI_EMPTY = "#1d222e";

export class Screens {
  private readonly hooks: ScreenHooks;
  private readonly masterSeed: number;
  private readonly levelScreen: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly hudLevel: HTMLElement;
  private readonly hudLevelNum: HTMLElement;
  private readonly complete: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly toastEl: HTMLElement;

  private readonly cache = new Map<number, Level>();
  private readonly cells: HTMLElement[] = [];
  private readonly doneState: boolean[] = [];
  private toastTimer = 0;

  constructor(masterSeed: number, hooks: ScreenHooks) {
    this.masterSeed = masterSeed;
    this.hooks = hooks;
    this.levelScreen = query("#level-screen");
    this.grid = query("#level-grid");
    this.progressLabel = query("#level-progress");
    this.hud = query("#hud");
    this.hudLevel = query("#hud-level");
    this.hudLevelNum = query("#hud-level-num");
    this.complete = query("#complete");
    this.nextButton = query<HTMLButtonElement>("#btn-next");
    this.toastEl = query("#toast");

    query("#btn-reset").addEventListener("click", () => this.hooks.onReset());
    query("#btn-menu").addEventListener("click", () => this.hooks.onMenu());
    query("#btn-complete-menu").addEventListener("click", () => this.hooks.onMenu());
    this.nextButton.addEventListener("click", () => {
      const to = Number(this.complete.dataset.next ?? "-1");
      if (to >= 0 && to < LEVEL_COUNT) this.hooks.onPlay(to);
    });

    this.buildGrid();
  }

  // -------------------------------------------------------------------------

  levelFor(index: number): Level {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const level = generateLevel(LEVEL_CONFIGS[index], this.masterSeed);
    this.cache.set(index, level);
    return level;
  }

  refresh(save: SaveData): void {
    this.progressLabel.textContent = `${save.completed.length} / ${LEVEL_COUNT}`;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const cell = this.cells[i];
      const done = save.completed.includes(i);
      const unlocked = isUnlocked(save, i);
      cell.classList.toggle("locked", !unlocked);
      cell.classList.toggle("done", done);
      cell.classList.toggle("current", unlocked && !done);
      cell.setAttribute("aria-disabled", String(!unlocked));
      if (this.doneState[i] !== done) {
        this.doneState[i] = done;
        const mini = renderMini(this.levelFor(i), done);
        const old = cell.querySelector(".mini");
        if (old) old.replaceWith(mini);
        else cell.appendChild(mini);
      }
    }
  }

  showLevels(save: SaveData): void {
    this.refresh(save);
    this.hideSolved();
    this.levelScreen.classList.remove("is-hidden");
    this.hud.classList.add("is-hidden");
    this.hudLevel.classList.add("is-hidden");
  }

  showGame(levelIndex: number): void {
    this.levelScreen.classList.add("is-hidden");
    this.hud.classList.remove("is-hidden");
    this.hudLevelNum.textContent = String(levelIndex + 1);
    this.hudLevel.classList.remove("is-hidden");
    this.hideSolved();
  }

  /** Show the solved dock. `nextIndex` < 0 means there is no next level. */
  showSolved(nextIndex: number): void {
    const hasNext = nextIndex >= 0 && nextIndex < LEVEL_COUNT;
    this.complete.dataset.next = String(hasNext ? nextIndex : -1);
    this.nextButton.classList.toggle("is-hidden", !hasNext);
    this.complete.classList.remove("is-hidden");
  }

  hideSolved(): void {
    this.complete.classList.add("is-hidden");
  }

  toast(message: string, duration = 2600): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), duration);
  }

  // -------------------------------------------------------------------------

  private buildGrid(): void {
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.level = String(i);
      cell.setAttribute("aria-label", `Level ${i + 1}`);
      cell.title = `Level ${i + 1}`;
      cell.addEventListener("click", () => {
        if (!cell.classList.contains("locked")) this.hooks.onPlay(i);
      });

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      cell.appendChild(num);
      cell.appendChild(renderMini(this.levelFor(i), false));
      this.grid.appendChild(cell);
      this.cells.push(cell);
      this.doneState.push(false);
    }
  }
}

function renderMini(level: Level, solved: boolean): HTMLCanvasElement {
  const n = level.size;
  const colors = solved ? solvedColors(level) : level.initial;
  const quads = miniQuads(level);

  const canvas = document.createElement("canvas");
  canvas.className = "mini";
  canvas.width = MINI_RES;
  canvas.height = MINI_RES;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("mini cube: 2d context unavailable");

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const face of quads) {
    for (const quad of face) {
      for (const p of quad) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  const pad = MINI_RES * 0.06;
  const scale = Math.min((MINI_RES - 2 * pad) / (maxX - minX), (MINI_RES - 2 * pad) / (maxY - minY));
  const ox = MINI_RES / 2 - ((minX + maxX) / 2) * scale;
  const oy = MINI_RES / 2 - ((minY + maxY) / 2) * scale;

  const trace = (quad: Quad, shrink: number): void => {
    const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
    const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
    ctx.beginPath();
    quad.forEach((p, i) => {
      const x = ox + (cx + (p.x - cx) * shrink) * scale;
      const y = oy + (cy + (p.y - cy) * shrink) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  ctx.fillStyle = MINI_BODY;
  for (const face of quads) {
    for (const quad of face) {
      trace(quad, 1);
      ctx.fill();
    }
  }

  quads.forEach((face, slot) => {
    face.forEach((quad, i) => {
      const color = colors[slot * n * n + i];
      trace(quad, MINI_TILE);
      ctx.fillStyle = color >= 0 ? level.palette[color] : MINI_EMPTY;
      ctx.fill();
    });
  });

  return canvas;
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}
