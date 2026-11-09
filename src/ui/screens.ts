import { LEVEL_COUNT, LEVEL_CONFIGS, LEVELS_PER_ZONE, ZONES } from "../core/curve.ts";
import { generateLevel, type Level } from "../core/level.ts";
import { isUnlocked, type SaveData } from "../state/progress.ts";
import { renderMini } from "./mini-cube.ts";

export interface ScreenHooks {
  onPlay: (levelIndex: number) => void;
  onZone: (zoneIndex: number) => void;
  onReset: () => void;
  onMenu: () => void;
}

/** Mirrors `repeat(5, …)` in `.level-grid` in styles.css. */
const GRID_COLUMNS = 5;

export class Screens {
  private readonly hooks: ScreenHooks;
  private readonly masterSeed: number;
  private readonly levelScreen: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly hudLevel: HTMLElement;
  private readonly hudLevelNum: HTMLElement;
  private readonly complete: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly toastEl: HTMLElement;

  private readonly cache = new Map<number, Level>();
  private readonly cells: HTMLElement[] = [];
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly doneState: boolean[] = [];
  private toastTimer = 0;
  private tabStop = 0;
  private activeZone = 0;
  private save: SaveData | null = null;

  constructor(masterSeed: number, hooks: ScreenHooks) {
    this.masterSeed = masterSeed;
    this.hooks = hooks;
    this.levelScreen = query("#level-screen");
    this.tabsEl = query("#zone-tabs");
    this.grid = query("#level-grid");
    this.progressLabel = query("#level-progress");
    this.hud = query("#hud");
    this.hudLevel = query("#hud-level");
    this.hudLevelNum = query("#hud-level-num");
    this.complete = query("#complete");
    this.nextButton = query<HTMLButtonElement>("#btn-next");
    this.menuButton = query<HTMLButtonElement>("#btn-menu");
    this.toastEl = query("#toast");

    query("#btn-reset").addEventListener("click", () => this.hooks.onReset());
    this.menuButton.addEventListener("click", () => this.hooks.onMenu());
    this.nextButton.addEventListener("click", () => {
      const to = Number(this.complete.dataset.next ?? "-1");
      if (to >= 0 && to < LEVEL_COUNT) this.hooks.onPlay(to);
    });

    this.buildTabs();
    this.buildGrid();
    arrowNav(this.tabsEl, 1);
    arrowNav(this.grid, GRID_COLUMNS);
    arrowNav(this.hud, 1);
    arrowNav(this.complete, 1);
    this.grid.addEventListener("focusin", (event) => {
      const i = this.cells.indexOf(event.target as HTMLElement);
      if (i >= 0) this.setTabStop(i);
    });
  }

  // -------------------------------------------------------------------------

  levelFor(index: number): Level {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const level = generateLevel(LEVEL_CONFIGS[index], this.masterSeed);
    this.cache.set(index, level);
    return level;
  }

  get area(): number {
    return this.activeZone;
  }

  refresh(save: SaveData): void {
    this.save = save;
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

    let stop = this.cells.findIndex((cell) => cell.classList.contains("current"));
    if (stop < 0) {
      for (let i = LEVEL_COUNT - 1; i >= 0; i--) {
        if (isUnlocked(save, i)) {
          stop = i;
          break;
        }
      }
    }
    this.activeZone = Math.max(this.activeZone, Math.floor(Math.max(stop, 0) / LEVELS_PER_ZONE));
    if (!isUnlocked(save, ZONES[this.activeZone].from)) {
      this.activeZone = this.lastReachedZone(save);
    }

    this.updateTabs(save);
    this.updateProgress(save);
    this.renderZone();
    this.setTabStop(this.stopForZone(save, this.activeZone));
  }

  showLevels(save: SaveData, area?: number): void {
    const fromGame = this.levelScreen.classList.contains("is-hidden");
    this.refresh(save);
    if (area !== undefined) this.setZone(area);
    this.hideSolved();
    this.levelScreen.classList.remove("is-hidden");
    this.hud.classList.add("is-hidden");
    this.hudLevel.classList.add("is-hidden");
    if (fromGame) this.cells[this.tabStop].focus({ preventScroll: true });
  }

  showGame(levelIndex: number): void {
    this.activeZone = Math.max(this.activeZone, Math.floor(levelIndex / LEVELS_PER_ZONE));
    this.levelScreen.classList.add("is-hidden");
    this.hud.classList.remove("is-hidden");
    this.hudLevelNum.textContent = String(levelIndex + 1);
    this.hudLevel.classList.remove("is-hidden");
    this.hideSolved();
  }

  /** Show the solved next-level button. `nextIndex` < 0 means there is no next level. */
  showSolved(nextIndex: number): void {
    const hasNext = nextIndex >= 0 && nextIndex < LEVEL_COUNT;
    this.complete.dataset.next = String(hasNext ? nextIndex : -1);
    this.nextButton.classList.toggle("is-hidden", !hasNext);
    this.complete.classList.remove("is-hidden");
    (hasNext ? this.nextButton : this.menuButton).focus({ preventScroll: true });
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

  private buildTabs(): void {
    ZONES.forEach((zone, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = `zone-tab-${index}`;
      tab.className = "zone-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "level-grid");
      tab.textContent = zone.name;
      tab.addEventListener("click", () => this.selectZone(index));
      tab.addEventListener("focus", () => this.selectZone(index));
      this.tabsEl.appendChild(tab);
      this.tabs.push(tab);
    });
  }

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
      this.cells.push(cell);
      this.doneState.push(false);
    }
    this.setTabStop(0);
  }

  private selectZone(index: number): void {
    if (!this.save || index === this.activeZone || this.tabs[index].disabled) return;
    this.setZone(index);
    this.hooks.onZone(index);
  }

  private setZone(index: number): void {
    const save = this.save;
    if (!save || this.tabs[index].disabled) return;
    this.activeZone = index;
    this.updateTabs(save);
    this.updateProgress(save);
    this.renderZone();
    this.setTabStop(this.stopForZone(save, index));
  }

  private updateTabs(save: SaveData): void {
    this.tabs.forEach((tab, index) => {
      const reached = isUnlocked(save, ZONES[index].from);
      const active = index === this.activeZone;
      tab.disabled = !reached;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.title = reached ? `${ZONES[index].name} area` : "Complete the previous area to unlock";
    });
    this.grid.setAttribute("aria-labelledby", this.tabs[this.activeZone].id);
  }

  private updateProgress(save: SaveData): void {
    const zone = ZONES[this.activeZone];
    const total = zone.to - zone.from + 1;
    let done = 0;
    for (let i = zone.from; i <= zone.to; i++) {
      if (save.completed.includes(i)) done++;
    }
    this.progressLabel.textContent = `${done} / ${total}`;
    this.progressLabel.setAttribute(
      "aria-label",
      `${zone.name}: ${done} of ${total} levels complete`
    );
  }

  private renderZone(): void {
    const zone = ZONES[this.activeZone];
    this.grid.replaceChildren(...this.cells.slice(zone.from, zone.to + 1));
  }

  private lastReachedZone(save: SaveData): number {
    for (let i = ZONES.length - 1; i > 0; i--) {
      if (isUnlocked(save, ZONES[i].from)) return i;
    }
    return 0;
  }

  private stopForZone(save: SaveData, index: number): number {
    const zone = ZONES[index];
    for (let i = zone.from; i <= zone.to; i++) {
      if (isUnlocked(save, i) && !save.completed.includes(i)) return i;
    }
    for (let i = zone.to; i >= zone.from; i--) {
      if (isUnlocked(save, i)) return i;
    }
    return zone.from;
  }

  private setTabStop(index: number): void {
    this.tabStop = index;
    this.cells.forEach((cell, i) => {
      cell.tabIndex = i === index ? 0 : -1;
    });
  }
}

/** Arrow/Home/End focus movement between visible buttons in `container`. */
function arrowNav(container: HTMLElement, columns: number): void {
  container.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>(":scope > button")).filter(
      (el) => !el.classList.contains("is-hidden") && !el.disabled
    );
    const current = items.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = current - 1; break;
      case "ArrowRight": next = current + 1; break;
      case "ArrowUp": next = current - columns; break;
      case "ArrowDown": next = current + columns; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    if (next >= 0 && next < items.length && next !== current) items[next].focus();
  });
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}
