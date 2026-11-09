/** Level-screen mini cube: one canvas per level, drawn from the same
 *  isometric projection the 3D view uses. */

import { solvedColors, type Level } from "../core/level.ts";
import { miniQuads, type Quad } from "../core/preview.ts";

/** Internal canvas resolution; CSS scales it down, so edges stay crisp. */
const MINI_RES = 192;
/** Fraction of each tile kept when insetting it: the seam width is uniform. */
const MINI_TILE = 0.88;
/** Mirrors TILE_CORNER in render/meshes.ts: corner radius as a fraction of the tile edge. */
const MINI_CORNER = 0.22;
/** Cubic bezier control offset for a quarter circle of unit radius. */
const ARC_K = 0.5523;
const MINI_BODY = "#05060a";
const MINI_EMPTY = "#1d222e";

export function renderMini(level: Level, solved: boolean): HTMLCanvasElement {
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

  // Quads are parallel projections of squares, so tracing the rounded square in
  // the tile's own (u, v) space and mapping it affinely gives the exact
  // projected corners (affine maps carry beziers to beziers).
  const trace = (quad: Quad, shrink: number, corner: number): void => {
    const [q0, q1, , q3] = quad;
    const at = (u: number, v: number): [number, number] => [
      ox + (q0.x + (q1.x - q0.x) * u + (q3.x - q0.x) * v) * scale,
      oy + (q0.y + (q1.y - q0.y) * u + (q3.y - q0.y) * v) * scale
    ];
    const lo = (1 - shrink) / 2;
    const hi = (1 + shrink) / 2;
    const r = corner * shrink;
    const k = r * ARC_K;
    // corner (cu, cv) of the square, reached along -du and left along dv
    const corners: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [hi, lo, 1, 0, 0, 1],
      [hi, hi, 0, 1, -1, 0],
      [lo, hi, -1, 0, 0, -1],
      [lo, lo, 0, -1, 1, 0]
    ];
    ctx.beginPath();
    corners.forEach(([cu, cv, iu, iv, eu, ev], i) => {
      const start = at(cu - iu * r, cv - iv * r);
      if (i === 0) ctx.moveTo(...start);
      else ctx.lineTo(...start);
      if (r > 0) {
        ctx.bezierCurveTo(
          ...at(cu - iu * (r - k), cv - iv * (r - k)),
          ...at(cu + eu * (r - k), cv + ev * (r - k)),
          ...at(cu + eu * r, cv + ev * r)
        );
      }
    });
    ctx.closePath();
  };

  ctx.fillStyle = MINI_BODY;
  for (const face of quads) {
    for (const quad of face) {
      trace(quad, 1, 0);
      ctx.fill();
    }
  }

  quads.forEach((face, slot) => {
    face.forEach((quad, i) => {
      const color = colors[slot * n * n + i];
      trace(quad, MINI_TILE, MINI_CORNER);
      ctx.fillStyle = color >= 0 ? level.palette[color] : MINI_EMPTY;
      ctx.fill();
    });
  });

  return canvas;
}
