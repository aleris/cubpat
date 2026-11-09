/** Level progression: zones, grading curve, and per-level variation. */

export const LEVEL_VARIANTS = ["balanced", "spread", "mixed", "clustered", "edge"] as const;

export type LevelVariant = (typeof LEVEL_VARIANTS)[number];

export interface LevelConfig {
  index: number;
  size: number;
  colors: number;
  variant: LevelVariant;
}

export interface Zone {
  index: number;
  name: string;
  /** first level index, inclusive */
  from: number;
  /** last level index, inclusive */
  to: number;
}

export const LEVELS_PER_ZONE = 25;

const ZONE_NAMES = ["Foundations", "Expansion", "Mastery"] as const;

export const ZONES: readonly Zone[] = ZONE_NAMES.map((name, index) => ({
  index,
  name,
  from: index * LEVELS_PER_ZONE,
  to: (index + 1) * LEVELS_PER_ZONE - 1
}));

interface CurveSpan {
  levels: number;
  size: number;
  colors: number;
}

/**
 * Three 25-level zones. Zone 2 opens with a 4×4 row and then moves to 5×5;
 * zone 3 opens with a 5×5 row and then moves to 6×6. Colours rise slowly and
 * stop at 9, where the palette and the tile motifs still stay distinct.
 */
const CURVE_SPANS: readonly CurveSpan[] = [
  // Zone 1: 2×2 / 3×3 / 4×4, max 4 colours.
  { levels: 2, size: 2, colors: 2 },
  { levels: 3, size: 3, colors: 2 },
  { levels: 7, size: 3, colors: 3 },
  { levels: 6, size: 4, colors: 3 },
  { levels: 7, size: 4, colors: 4 },
  // Zone 2: 4×4 first row, then 5×5, colours 4 → 7.
  { levels: 3, size: 4, colors: 4 },
  { levels: 2, size: 4, colors: 5 },
  { levels: 4, size: 5, colors: 5 },
  { levels: 7, size: 5, colors: 6 },
  { levels: 9, size: 5, colors: 7 },
  // Zone 3: 5×5 first row, then 6×6, colours 7 → 9.
  { levels: 2, size: 5, colors: 7 },
  { levels: 3, size: 5, colors: 8 },
  { levels: 8, size: 6, colors: 8 },
  { levels: 12, size: 6, colors: 9 }
];

const CURVE: ReadonlyArray<readonly [number, number]> = CURVE_SPANS.flatMap(
  ({ levels, size, colors }) => Array.from({ length: levels }, () => [size, colors] as const)
);

export const LEVEL_COUNT = CURVE.length;

/**
 * The tutorial row stays balanced. From level 6 on, the five variants repeat
 * column by column in the 5-wide level grid.
 */
export function variantForLevel(index: number): LevelVariant {
  return index < 5 ? "balanced" : LEVEL_VARIANTS[index % LEVEL_VARIANTS.length];
}

export const LEVEL_CONFIGS: LevelConfig[] = CURVE.map(([size, colors], index) => ({
  index,
  size,
  colors,
  variant: variantForLevel(index)
}));
