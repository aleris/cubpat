/** Level progression: the grading curve and the level configuration it defines. */

export interface LevelConfig {
  index: number;
  size: number;
  colors: number;
}

/** Grading curve for the 25 levels: [cube size, colour count].
 *  Only three faces are in play (3·n² squares), so a level has 2·colors
 *  pre-coloured squares and colours·(3n²/colors) squares in the solution. */
const CURVE: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [2, 2],
  [3, 3],
  [3, 3],
  [3, 4],
  [4, 4],
  [4, 5],
  [4, 6],
  [4, 6],
  [5, 7],
  [5, 7],
  [5, 8],
  [5, 8],
  [5, 9],
  [6, 10],
  [6, 10],
  [6, 11],
  [6, 11],
  [6, 12],
  [6, 12],
  [6, 13],
  [6, 13],
  [6, 14],
  [6, 14],
  [6, 15]
];

export const LEVEL_COUNT = CURVE.length;

export const LEVEL_CONFIGS: LevelConfig[] = CURVE.map(([size, colors], i) => ({
  index: i,
  size,
  colors
}));
