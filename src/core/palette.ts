/** Level palette.
 *
 *  Golden-angle hues so any prefix of the palette stays visually distinct: a
 *  level uses the first `colors` entries, and the next level's extra colours
 *  slot between them without reusing a neighbour's hue.
 */

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number): string => {
    const n = Math.round(Math.min(1, Math.max(0, v + m)) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to(r)}${to(g)}${to(b)}`;
}

const PALETTE_SIZE = 20;
const PALETTE: string[] = Array.from({ length: PALETTE_SIZE }, (_, i) => {
  const hue = (i * 137.508 + 6) % 360;
  const lightness = i % 3 === 0 ? 0.58 : i % 3 === 1 ? 0.66 : 0.52;
  return hslToHex(hue, 0.83, lightness);
});

/** CSS colour of colour index `index`, wrapping around the palette. */
export function colorFor(index: number): string {
  return PALETTE[index % PALETTE_SIZE];
}
