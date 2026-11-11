import { LEVEL_COUNT, LEVEL_CONFIGS, LEVELS_PER_ZONE, ZONES } from "../core/curve.ts";
import { generateLevel, type Level } from "../core/level.ts";
import { isUnlocked, type SaveData } from "../state/progress.ts";
import { renderColorTiles } from "./color-tiles.ts";
import { renderMini } from "./mini-cube.ts";

export interface ScreenHooks {
  onPlay: (levelIndex: number) => void;
  onZone: (zoneIndex: number) => void;
  /** The just-solved level finished its area; open the next area's menu. */
  onZoneCleared: (zoneIndex: number) => void;
  onReset: () => void;
  onMenu: () => void;
}

/** Mirrors `repeat(5, …)` in `.level-grid` in styles.css. */
const GRID_COLUMNS = 5;

/** Level intro timings: a slow reveal, then a quick hand-off to the cube. */
const INTRO_IN_MS = 520;
const INTRO_OUT_MS = 180;

export class Screens {
  private readonly hooks: ScreenHooks;
  private readonly masterSeed: number;
  private readonly levelScreen: HTMLElement;
  private readonly zoneHead: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly underline: HTMLElement;
  /** Counter shown while no tab is visible (the very first area). */
  private readonly zoneProgress: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly hudLevel: HTMLElement;
  private readonly hudLevelNum: HTMLElement;
  private readonly complete: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly toastEl: HTMLElement;
  private readonly introEl: HTMLButtonElement;
  private readonly introNum: HTMLElement;
  private readonly introMax: HTMLElement;
  private readonly introSize: HTMLElement;
  private readonly introColors: HTMLElement;

  private readonly cache = new Map<number, Level>();
  private readonly cells: HTMLElement[] = [];
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly doneState: boolean[] = [];
  private toastTimer = 0;
  /** Timer done: the next player input may dismiss the toast. */
  private toastDismissable = false;
  private transitionTimer = 0;
  private celebrateTimer = 0;
  private unlockTimer = 0;
  private introAnimation: Animation | null = null;
  private introTimer = 0;
  /** Set while the intro is up; resolved once it is started or cancelled. */
  private introResolve: ((started: boolean) => void) | null = null;
  private tabStop = 0;
  private activeZone = 0;
  /** New area to celebrate on the next Next press, or -1 for a normal next level. */
  private nextArea = -1;
  private save: SaveData | null = null;

  constructor(masterSeed: number, hooks: ScreenHooks) {
    this.masterSeed = masterSeed;
    this.hooks = hooks;
    this.levelScreen = query("#level-screen");
    this.zoneHead = query(".zone-head");
    this.tabsEl = query("#zone-tabs");
    this.grid = query("#level-grid");
    this.hud = query("#hud");
    this.hudLevel = query("#hud-level");
    this.hudLevelNum = query("#hud-level-num");
    this.complete = query("#complete");
    this.nextButton = query<HTMLButtonElement>("#btn-next");
    this.menuButton = query<HTMLButtonElement>("#btn-menu");
    this.toastEl = query("#toast");
    this.introEl = query<HTMLButtonElement>("#intro-screen");
    this.introNum = query("#intro-level-num");
    this.introMax = query("#intro-level-max");
    this.introSize = query("#intro-size");
    this.introColors = query("#intro-colors");

    const underline = document.createElement("span");
    underline.className = "zone-underline";
    underline.setAttribute("aria-hidden", "true");
    this.zoneHead.appendChild(underline);
    this.underline = underline;

    const progress = document.createElement("p");
    progress.className = "zone-progress";
    progress.hidden = true;
    this.zoneHead.appendChild(progress);
    this.zoneProgress = progress;

    query("#btn-reset").addEventListener("click", () => this.hooks.onReset());
    this.menuButton.addEventListener("click", () => this.hooks.onMenu());
    this.introEl.addEventListener("pointerdown", this.onIntroStart);
    this.introEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") this.onIntroStart();
    });
    this.nextButton.addEventListener("click", () => {
      if (this.nextArea >= 0) {
        const area = this.nextArea;
        this.nextArea = -1;
        this.hooks.onZoneCleared(area);
        return;
      }
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
    window.addEventListener("resize", () => {
      if (!this.levelScreen.classList.contains("is-hidden")) this.placeUnderline(this.activeZone);
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

  refresh(save: SaveData, keepZone = false): void {
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

    if (!keepZone) {
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
    }

    this.updateTabs(save);
    this.updateProgress(save);
    this.renderZone();
    this.setTabStop(this.stopForZone(save, this.activeZone));
  }

  showLevels(save: SaveData, area?: number, celebrate = false): void {
    this.cancelIntro();
    this.clearToast();
    const fromGame = this.levelScreen.classList.contains("is-hidden");

    if (celebrate && area !== undefined && area > 0) {
      // Show the area that was just finished first: its tab keeps the selection
      // and gains the tick, then the line travels to the new area.
      const from = area - 1;
      this.activeZone = from;
      this.refresh(save, true);
      this.hideSolved();
      this.levelScreen.classList.remove("is-hidden");
      this.hud.classList.add("is-hidden");
      this.hudLevel.classList.add("is-hidden");
      this.placeUnderline(from);
      window.clearTimeout(this.transitionTimer);
      this.transitionTimer = window.setTimeout(
        () => this.playZoneTransition(from, area),
        420
      );
      return;
    }

    this.refresh(save);
    if (area !== undefined) this.setZone(area);
    this.hideSolved();
    this.levelScreen.classList.remove("is-hidden");
    this.hud.classList.add("is-hidden");
    this.hudLevel.classList.add("is-hidden");
    this.placeUnderline(this.activeZone);
    if (fromGame) this.cells[this.tabStop].focus({ preventScroll: true });
  }

  showGame(levelIndex: number): void {
    this.clearToast();
    this.activeZone = Math.max(this.activeZone, Math.floor(levelIndex / LEVELS_PER_ZONE));
    this.levelScreen.classList.add("is-hidden");
    this.hud.classList.remove("is-hidden");
    this.hudLevelNum.textContent = String(levelIndex + 1);
    this.hudLevel.classList.remove("is-hidden");
    this.hideSolved();
  }

  /**
   * Level intro: the level number, cube size and colour tiles on the page
   * background, with the menu as the only HUD control. Resolves true when the
   * player starts the level; false when the screen is cancelled (routed away).
   */
  showIntro(level: Level): Promise<boolean> {
    this.cancelIntro();
    this.clearToast();
    this.hideSolved();
    this.activeZone = Math.max(this.activeZone, Math.floor(level.index / LEVELS_PER_ZONE));
    this.levelScreen.classList.add("is-hidden");

    this.introNum.textContent = String((level.index % LEVELS_PER_ZONE) + 1);
    this.introMax.textContent = `/ ${LEVELS_PER_ZONE}`;
    this.introSize.textContent = `${level.size}×${level.size}`;
    this.introColors.replaceChildren(renderColorTiles(level));
    this.introEl.setAttribute("aria-label", `Start level ${level.index + 1}`);

    this.hud.classList.remove("is-hidden");
    this.hud.classList.add("is-intro");
    this.hudLevel.classList.add("is-hidden");

    this.introEl.classList.remove("is-hidden");
    this.fadeIntro(0, 1, INTRO_IN_MS, "cubic-bezier(0.22, 0.61, 0.36, 1)");
    return new Promise<boolean>((resolve) => {
      this.introResolve = resolve;
    });
  }

  /** Any press starts the level: fade the intro out under the arriving cube. */
  private readonly onIntroStart = (): void => {
    const resolve = this.introResolve;
    if (!resolve) return;
    this.introResolve = null;
    const from = Number.parseFloat(getComputedStyle(this.introEl).opacity) || 0;
    this.fadeIntro(from, 0, INTRO_OUT_MS, "ease-in");
    window.clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => {
      this.introTimer = 0;
      this.introEl.classList.add("is-hidden");
      this.introAnimation?.cancel();
      this.introAnimation = null;
      this.hud.classList.remove("is-intro");
    }, INTRO_OUT_MS + 20);
    resolve(true);
  };

  /** Drop the intro without starting a level, e.g. after a popstate. */
  private cancelIntro(): void {
    window.clearTimeout(this.introTimer);
    this.introTimer = 0;
    this.introAnimation?.cancel();
    this.introAnimation = null;
    this.introEl.classList.add("is-hidden");
    this.hud.classList.remove("is-intro");
    const resolve = this.introResolve;
    this.introResolve = null;
    resolve?.(false);
  }

  private fadeIntro(from: number, to: number, duration: number, easing: string): void {
    this.introAnimation?.cancel();
    this.introAnimation = this.introEl.animate([{ opacity: from }, { opacity: to }], {
      duration,
      easing,
      fill: "both"
    });
  }

  /** Show the solved next-level button. `nextIndex` < 0 means there is no next level. */
  showSolved(nextIndex: number): void {
    this.clearToast();
    const hasNext = nextIndex >= 0 && nextIndex < LEVEL_COUNT;
    const crossesZone = hasNext && nextIndex > 0 && nextIndex % LEVELS_PER_ZONE === 0;
    this.nextArea =
      crossesZone && this.zoneDone(this.save, nextIndex / LEVELS_PER_ZONE - 1)
        ? nextIndex / LEVELS_PER_ZONE
        : -1;
    this.complete.dataset.next = String(hasNext ? nextIndex : -1);
    this.nextButton.classList.toggle("is-hidden", !hasNext);
    this.nextButton.setAttribute("aria-label", this.nextArea >= 0 ? "Start next area" : "Next level");
    this.nextButton.title = this.nextArea >= 0 ? "Start next area" : "Next level";
    this.complete.classList.remove("is-hidden");
    (hasNext ? this.nextButton : this.menuButton).focus({ preventScroll: true });
  }

  hideSolved(): void {
    this.nextArea = -1;
    this.complete.classList.add("is-hidden");
  }

  /**
   * Show a message until the player acts.
   *
   * `duration` is a floor, not a deadline: the toast stays up while the player
   * is idle, so an important hint is still on screen when they look back. It
   * goes away on the first player input after that floor has elapsed.
   */
  toast(message: string, duration = 2600): void {
    this.unlistenToast();
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    this.toastDismissable = false;
    // Capture, so the input counts even when the level's own canvas handler
    // would stop it. A press cannot dismiss the toast it just created: the
    // window capture phase has already run by the time the hint is raised.
    window.addEventListener("pointerdown", this.onToastAction, { capture: true, passive: true });
    window.addEventListener("keydown", this.onToastAction, true);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = 0;
      this.toastDismissable = true;
    }, duration);
  }

  private readonly onToastAction = (): void => {
    if (this.toastDismissable) this.clearToast();
  };

  /** Drop the toast with its timer and input hooks, e.g. when the screen changes. */
  private clearToast(): void {
    window.clearTimeout(this.toastTimer);
    this.toastTimer = 0;
    this.toastDismissable = false;
    this.unlistenToast();
    this.toastEl.classList.remove("show");
  }

  private unlistenToast(): void {
    window.removeEventListener("pointerdown", this.onToastAction, true);
    window.removeEventListener("keydown", this.onToastAction, true);
  }

  // -------------------------------------------------------------------------

  private buildTabs(): void {
    ZONES.forEach((zone, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = `zone-tab-${index}`;
      tab.className = "zone-tab";
      tab.dataset.state = "locked";
      tab.hidden = true;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "level-grid");

      const label = document.createElement("span");
      label.className = "zone-tab-label";
      const name = document.createElement("span");
      name.className = "zone-tab-name";
      name.textContent = zone.name;
      label.append(name);

      const sub = document.createElement("span");
      sub.className = "zone-tab-sub";

      tab.append(label, sub);
      tab.addEventListener("click", () => this.selectZone(index));
      tab.addEventListener("focus", () => this.selectZone(index));
      tab.addEventListener("animationend", (event) => {
        if (event.target === tab) tab.classList.remove("is-revealing");
      });
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
    if (!this.save || index === this.activeZone) return;
    if (this.tabs[index].hidden || this.tabs[index].disabled) return;
    this.setZone(index);
    this.hooks.onZone(index);
  }

  private setZone(index: number): void {
    const save = this.save;
    if (!save || this.tabs[index].hidden || this.tabs[index].disabled) return;
    const from = this.activeZone;
    this.activeZone = index;
    this.updateTabs(save);
    this.updateProgress(save);
    this.renderZone();
    this.setTabStop(this.stopForZone(save, index));
    this.placeUnderline(index, from);
  }

  /** Slide the tab line to `to`, rainbow the new tab and swap in its levels. */
  private playZoneTransition(from: number, to: number): void {
    const save = this.save;
    if (!save) return;
    this.activeZone = to;
    this.updateTabs(save);
    this.updateProgress(save);
    this.renderZone();
    this.setTabStop(this.stopForZone(save, to));
    this.placeUnderline(to, from);

    const tab = this.tabs[to];
    tab.classList.add("is-celebrating");
    this.underline.classList.add("is-rainbow");
    this.grid.classList.add("is-celebrating");
    window.clearTimeout(this.celebrateTimer);
    window.clearTimeout(this.unlockTimer);
    // The cells open as soon as the line lands; the rainbow keeps cycling.
    this.unlockTimer = window.setTimeout(() => this.grid.classList.remove("is-celebrating"), 900);
    this.celebrateTimer = window.setTimeout(() => {
      tab.classList.remove("is-celebrating");
      this.underline.classList.remove("is-rainbow");
    }, 4800);

    this.cells[this.tabStop]?.focus({ preventScroll: true });
  }

  private updateTabs(save: SaveData): void {
    this.tabs.forEach((tab, index) => {
      const zone = ZONES[index];
      const reached = isUnlocked(save, zone.from);
      // A tab appears only once its area opens, i.e. the previous area is done.
      // The first area has no previous area, so a lone tab would be noise: it
      // waits for the second area while `.zone-progress` carries the counter.
      const visible = index === 0 ? ZONES.length > 1 && isUnlocked(save, ZONES[1].from) : reached;
      const reveal = tab.hidden && visible;
      tab.hidden = !visible;
      if (reveal) {
        // A freshly opened area fades in instead of popping into the row.
        tab.classList.remove("is-revealing");
        void tab.offsetWidth;
        tab.classList.add("is-revealing");
      }
      const active = index === this.activeZone;
      const done = this.zoneDone(save, index);
      tab.disabled = !reached;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.title = done
        ? `${zone.name}: area complete`
        : reached
          ? `${zone.name} area`
          : "Complete the previous area to unlock";
    });
    this.grid.setAttribute("aria-labelledby", this.tabs[this.activeZone].id);
  }

  private updateProgress(save: SaveData): void {
    this.tabs.forEach((tab, index) => {
      const zone = ZONES[index];
      const total = zone.to - zone.from + 1;
      let done = 0;
      for (let i = zone.from; i <= zone.to; i++) {
        if (save.completed.includes(i)) done++;
      }
      const sub = tab.querySelector<HTMLElement>(".zone-tab-sub");
      if (sub) sub.textContent = index === this.activeZone ? `${done} / ${total}` : "";
      if (index === this.activeZone) {
        this.zoneProgress.textContent = `${done} / ${total}`;
        this.zoneProgress.hidden = !tab.hidden;
      }
      tab.setAttribute("aria-label", `${zone.name}: ${done} of ${total} levels complete`);
    });
  }

  private renderZone(): void {
    const zone = ZONES[this.activeZone];
    this.grid.replaceChildren(...this.cells.slice(zone.from, zone.to + 1));
  }

  /** Pixel box of a tab's label row, relative to `.zone-head`. */
  private labelRect(index: number): { left: number; width: number; top: number } | null {
    const label = this.tabs[index]?.querySelector<HTMLElement>(".zone-tab-label");
    if (!label) return null;
    const base = this.zoneHead.getBoundingClientRect();
    const rect = label.getBoundingClientRect();
    if (base.width === 0 || rect.width === 0) return null;
    return { left: rect.left - base.left, width: rect.width, top: rect.bottom - base.top };
  }

  /** Park the tab line under `index`, sliding from `from` when given. */
  private placeUnderline(index: number, from?: number): void {
    const target = this.labelRect(index);
    if (!target) {
      for (const animation of this.underline.getAnimations()) animation.cancel();
      this.underline.style.opacity = "0";
      return;
    }
    const source = from !== undefined && from !== index ? this.labelRect(from) : null;
    for (const animation of this.underline.getAnimations()) animation.cancel();
    if (source) {
      this.underline.animate(
        [
          { left: `${source.left}px`, width: `${source.width}px`, top: `${source.top}px` },
          { left: `${target.left}px`, width: `${target.width}px`, top: `${target.top}px` }
        ],
        { duration: 640, easing: "cubic-bezier(0.32, 0.04, 0.16, 1)" }
      );
    }
    this.underline.style.left = `${target.left}px`;
    this.underline.style.width = `${target.width}px`;
    this.underline.style.top = `${target.top}px`;
    this.underline.style.opacity = "1";
  }

  private zoneDone(save: SaveData | null, index: number): boolean {
    if (!save) return false;
    const zone = ZONES[index];
    for (let i = zone.from; i <= zone.to; i++) {
      if (!save.completed.includes(i)) return false;
    }
    return true;
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
      (el) => !el.hidden && !el.classList.contains("is-hidden") && !el.disabled
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
