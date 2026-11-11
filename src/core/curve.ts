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
 * Three 25-level zones. Colours rise slowly and stop at 10, where the palette and the tile motifs still stay distinct.
 */
const CURVE_SPANS: readonly CurveSpan[] = [
  // Zone 1
  { levels: 2, size: 2, colors: 2 },
  { levels: 3, size: 3, colors: 3 },
  { levels: 5, size: 3, colors: 4 },
  { levels: 5, size: 4, colors: 5 },
  { levels: 5, size: 4, colors: 6 },
  { levels: 5, size: 4, colors: 7 },
  // Zone 2
  { levels: 5, size: 4, colors: 8 },
  { levels: 5, size: 5, colors: 8 },
  { levels: 5, size: 5, colors: 9 },
  { levels: 5, size: 5, colors: 9 },
  { levels: 5, size: 5, colors: 9 },
  // Zone 3
  { levels: 5, size: 5, colors: 10 },
  { levels: 5, size: 6, colors: 10 },
  { levels: 5, size: 6, colors: 11 },
  { levels: 5, size: 6, colors: 12 },
  { levels: 5, size: 6, colors: 13 }
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
