/** Menu title treatment.
 *
 *  The word is laid out as a row of tiles: one palette-filled square per letter
 *  with an inverted (near-black) glyph, joined by short colour links. One seeded
 *  RNG keyed on the title text shuffles the palette, and a greedy pass keeps
 *  every tile at least 30° of hue away from the others, so neighbouring letters
 *  never read as the same colour while the styling stays identical on every load.
 *  Colours come from the same palette `colorFor` feeds the cube, restricted to
 *  entries bright enough to carry a near-black glyph.
 */
import { colorFor, PALETTE_SIZE } from "../core/palette.ts";
import { hashString, mulberry32, shuffleInPlace } from "../core/rng.ts";

const TITLE = "Cubpat";
const SEED = hashString(`cubpat:title:${TITLE}:v2`);

/** Chrome text on the near-black page needs this much relative luminance. */
const MIN_LUMINANCE = 0.28;
const TITLE_COLOURS = Array.from({ length: PALETTE_SIZE }, (_, i) => colorFor(i)).filter(
  (hex) => luminanceOf(hex) >= MIN_LUMINANCE
);

/** Minimum circular hue distance between any two tiles. */
const MIN_HUE_GAP = 30;

/** Replace the plain `<h1>` text with generated tiles and links. */
export function decorateTitle(): void {
  const heading = document.querySelector<HTMLHeadingElement>(".screen-head h1");
  if (!heading || heading.dataset.decorated === "true") return;
  heading.dataset.decorated = "true";
  heading.setAttribute("aria-label", TITLE);
  heading.textContent = "";

  const colours = pickColours(mulberry32(SEED), TITLE.length);

  const nodes: HTMLElement[] = [];
  Array.from(TITLE).forEach((char, i) => {
    const colour = colours[i];
    if (i > 0) nodes.push(buildLink(colour));
    nodes.push(buildTile(char, colour, i));
  });
  heading.append(...nodes);
}

/** Shuffled palette entries, each at least MIN_HUE_GAP from the ones already
 *  taken; the gap relaxes only if the bright palette cannot supply `count`. */
function pickColours(rng: () => number, count: number): string[] {
  const pool = shuffleInPlace(rng, [...TITLE_COLOURS]);
  const picked: string[] = [];
  for (const minGap of [MIN_HUE_GAP, MIN_HUE_GAP / 2, 0]) {
    for (const hex of pool) {
      if (picked.length === count) return picked;
      if (picked.includes(hex)) continue;
      const hue = hueOf(hex);
      if (picked.every((other) => hueGap(hue, hueOf(other)) >= minGap)) picked.push(hex);
    }
  }
  return picked;
}

/** Hue angle in degrees, 0–360. */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  const hue =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return ((hue * 60) % 360 + 360) % 360;
}

/** Circular distance between two hue angles. */
function hueGap(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

/** One letter: a coloured tile whose glyph is the page colour. */
function buildTile(char: string, colour: string, index: number): HTMLSpanElement {
  const tile = document.createElement("span");
  tile.className = "title-tile";
  tile.textContent = char;
  tile.setAttribute("aria-hidden", "true");
  tile.style.setProperty("--c", colour);
  tile.style.setProperty("--delay", `${index * 55}ms`);
  return tile;
}

/** The stitch into a tile: a short bar in that tile's palette colour. */
function buildLink(colour: string): HTMLSpanElement {
  const link = document.createElement("span");
  link.className = "title-link";
  link.setAttribute("aria-hidden", "true");
  link.style.setProperty("--c", colour);
  return link;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminanceOf(hex: string): number {
  const channel = (start: number): number => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
