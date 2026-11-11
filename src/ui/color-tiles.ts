/** Intro-screen colour strip: one tiny tile per colour, painted with the same
 *  palette colour × procedural motif the cube material uses, so the strip
 *  previews the tiles the level will actually show. */

import type { Level } from "../core/level.ts";
import { drawTilePattern } from "../render/tile-patterns.ts";

/** Swatch edge in canvas pixels; CSS shrinks the strip to ~20px tall. */
const SWATCH = 48;
/** Gap between tiles, as a fraction of the edge. */
const GAP = 0.24;
/** Corner radius as a fraction of the edge: TILE_CORNER in render/meshes.ts. */
const CORNER = 0.22;

export function renderColorTiles(level: Level): HTMLCanvasElement {
  const gap = Math.round(SWATCH * GAP);
  const canvas = document.createElement("canvas");
  canvas.className = "color-tiles";
  canvas.width = level.colors * SWATCH + (level.colors - 1) * gap;
  canvas.height = SWATCH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("color tiles: 2d context unavailable");

  const radius = SWATCH * CORNER;
  for (let i = 0; i < level.colors; i++) {
    const x = i * (SWATCH + gap);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, 0, SWATCH, SWATCH, radius);
    ctx.clip();
    ctx.fillStyle = level.palette[i];
    ctx.fillRect(x, 0, SWATCH, SWATCH);
    // The cube multiplies the motif over the diffuse colour; do the same here.
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(drawTilePattern(i), x, 0, SWATCH, SWATCH);
    ctx.restore();
  }

  return canvas;
}
