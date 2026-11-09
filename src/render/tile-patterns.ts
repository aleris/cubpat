/** Procedural tile motifs.
 *
 *  One 256×256 neutral grayscale map per colour index. The map multiplies the
 *  material's diffuse colour, so the hue stays the palette's and the motif adds
 *  a second, colour-blind-safe channel.
 *
 *  The motif is keyed directly by colour index, and there is one motif per
 *  palette entry (20). A level uses at most 10 colours, so two colours in the
 *  same level never share a pattern, and a colour keeps the same pattern across
 *  levels.
 */

export const TILE_PATTERN_SIZE = 256;

/** Motifs stay low-frequency: a tile is ~60–120 px on screen, so fine detail
 *  aliases into noise instead of reading as a pattern. */
type Motif = (ctx: CanvasRenderingContext2D, size: number) => void;

/** Centre line of each of a 3×3 grid. */
function centres(size: number): number[] {
  const step = size / 4;
  return [step, step * 2, step * 3];
}

function eachCentre(
  size: number,
  draw: (x: number, y: number, i: number, j: number) => void
): void {
  const axis = centres(size);
  for (let j = 0; j < axis.length; j++) {
    for (let i = 0; i < axis.length; i++) draw(axis[i], axis[j], i, j);
  }
}

const motifs: readonly Motif[] = [
  // 0: dots
  (ctx, size) => {
    eachCentre(size, (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fill();
    });
  },
  // 1: diagonal stripes
  (ctx, size) => {
    ctx.lineWidth = 22;
    for (let o = -size; o <= size * 2; o += 56) {
      ctx.beginPath();
      ctx.moveTo(o, 0);
      ctx.lineTo(o + size, size);
      ctx.stroke();
    }
  },
  // 2: cross-hatch
  (ctx, size) => {
    ctx.lineWidth = 15;
    for (let o = -size; o <= size * 2; o += 64) {
      ctx.beginPath();
      ctx.moveTo(o, 0);
      ctx.lineTo(o + size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(o + size, 0);
      ctx.lineTo(o, size);
      ctx.stroke();
    }
  },
  // 3: chevrons
  (ctx, size) => {
    ctx.lineWidth = 20;
    for (const y of centres(size)) {
      ctx.beginPath();
      ctx.moveTo(size * 0.16, y + 28);
      ctx.lineTo(size * 0.5, y - 28);
      ctx.lineTo(size * 0.84, y + 28);
      ctx.stroke();
    }
  },
  // 4: concentric rings
  (ctx, size) => {
    ctx.lineWidth = 18;
    const centre = size / 2;
    for (const radius of [0.14, 0.29, 0.44].map((f) => f * size)) {
      ctx.beginPath();
      ctx.arc(centre, centre, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  // 5: grid of open squares
  (ctx, size) => {
    ctx.lineWidth = 16;
    const side = size * 0.17;
    eachCentre(size, (x, y) => ctx.strokeRect(x - side / 2, y - side / 2, side, side));
  },
  // 6: vertical stripes
  (ctx, size) => {
    ctx.lineWidth = 22;
    for (let x = size * 0.11; x < size; x += 56) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
  },
  // 7: horizontal stripes
  (ctx, size) => {
    ctx.lineWidth = 22;
    for (let y = size * 0.11; y < size; y += 56) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  },
  // 8: zigzag bands
  (ctx, size) => {
    ctx.lineWidth = 18;
    const amplitude = size * 0.08;
    for (const y of centres(size)) {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = (i / 8) * size;
        const py = y + (i % 2 === 0 ? -amplitude : amplitude);
        if (i === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
  },
  // 9: sine waves
  (ctx, size) => {
    ctx.lineWidth = 18;
    for (const y of centres(size)) {
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const py = y + Math.sin(t * Math.PI * 4) * (size * 0.07);
        if (i === 0) ctx.moveTo(0, py);
        else ctx.lineTo(t * size, py);
      }
      ctx.stroke();
    }
  },
  // 10: scallops
  (ctx, size) => {
    ctx.lineWidth = 18;
    const radius = size * 0.12;
    for (const y of centres(size)) {
      for (let x = radius; x <= size; x += radius * 2) {
        ctx.beginPath();
        ctx.arc(x, y, radius, Math.PI, 0);
        ctx.stroke();
      }
    }
  },
  // 11: concentric squares
  (ctx, size) => {
    ctx.lineWidth = 16;
    const centre = size / 2;
    for (const side of [0.31, 0.5, 0.69].map((f) => f * size)) {
      ctx.strokeRect(centre - side / 2, centre - side / 2, side, side);
    }
  },
  // 12: grid of plus signs
  (ctx, size) => {
    ctx.lineWidth = 16;
    const arm = size * 0.09;
    eachCentre(size, (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.stroke();
    });
  },
  // 13: grid of diamonds
  (ctx, size) => {
    ctx.lineWidth = 16;
    const arm = size * 0.11;
    eachCentre(size, (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x + arm, y);
      ctx.lineTo(x, y + arm);
      ctx.lineTo(x - arm, y);
      ctx.closePath();
      ctx.stroke();
    });
  },
  // 14: alternating triangles
  (ctx, size) => {
    ctx.lineWidth = 16;
    const arm = size * 0.11;
    eachCentre(size, (x, y, i, j) => {
      const up = (i + j) % 2 === 0;
      ctx.beginPath();
      if (up) {
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x + arm, y + arm);
        ctx.lineTo(x - arm, y + arm);
      } else {
        ctx.moveTo(x, y + arm);
        ctx.lineTo(x + arm, y - arm);
        ctx.lineTo(x - arm, y - arm);
      }
      ctx.closePath();
      ctx.stroke();
    });
  },
  // 15: grid of hexagons
  (ctx, size) => {
    ctx.lineWidth = 16;
    const radius = size * 0.105;
    eachCentre(size, (x, y) => {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k * Math.PI) / 3 - Math.PI / 6;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    });
  },
  // 16: checkerboard
  (ctx, size) => {
    const cell = size / 4;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        if ((i + j) % 2 === 0) ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    }
  },
  // 17: offset bricks
  (ctx, size) => {
    ctx.lineWidth = 16;
    const height = size * 0.2;
    const width = size * 0.33;
    for (let row = 0; row < 4; row++) {
      const y = size * 0.1 + row * height;
      const offset = row % 2 === 0 ? 0 : -width / 2;
      for (let x = offset; x < size; x += width) {
        ctx.strokeRect(x, y, width, height);
      }
    }
  },
  // 18: staggered dots
  (ctx, size) => {
    const radius = size * 0.058;
    const step = size / 4;
    for (let row = 0; row < 3; row++) {
      const y = step * (row + 1);
      const offset = row % 2 === 0 ? 0 : step / 2;
      for (let x = step / 2 + offset; x < size; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  // 19: six-point asterisks
  (ctx, size) => {
    ctx.lineWidth = 14;
    const arm = size * 0.095;
    eachCentre(size, (x, y) => {
      for (let k = 0; k < 3; k++) {
        const angle = (k * Math.PI) / 3;
        const dx = Math.cos(angle) * arm;
        const dy = Math.sin(angle) * arm;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      }
    });
  }
];

export const PATTERN_COUNT = motifs.length;

export function drawTilePattern(colorIndex: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PATTERN_SIZE;
  canvas.height = TILE_PATTERN_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, TILE_PATTERN_SIZE, TILE_PATTERN_SIZE);
  ctx.strokeStyle = "#b6b6b6";
  ctx.fillStyle = "#b6b6b6";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 18;
  const index = ((colorIndex % PATTERN_COUNT) + PATTERN_COUNT) % PATTERN_COUNT;
  motifs[index](ctx, TILE_PATTERN_SIZE);
  return canvas;
}
