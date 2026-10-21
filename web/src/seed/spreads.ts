// Spread template seed: schema, types and the parsed `spreads.json`.
//
// Position `index` is the 1-based number shown to her ("carta 4"); card draws store it as
// `position_index`. `layout` places each position on a grid for the spread view: `col` and
// `row` are 0-based, and `rotated` marks a card laid crosswise (the Cruz Celta's Desafío),
// which is the only case where two positions share a cell.
//
// Seed spreads are read-only in the app: to change one she copies it into a custom spread.

import { z } from 'zod';

import raw from './spreads.json' with { type: 'json' };

const text = z.string().trim().min(1);

export const spreadLayoutSchema = z.strictObject({
  col: z.int().min(0),
  row: z.int().min(0),
  rotated: z.boolean(),
});

export const spreadPositionSchema = z.strictObject({
  index: z.int().min(1),
  name: text,
  meaning: text,
  layout: spreadLayoutSchema,
});

/**
 * The grid every spread is drawn on, seed or custom: 7 columns (the Herradura's width) by 5
 * rows. The custom spread builder places cards on exactly this grid.
 */
export const SPREAD_GRID = { cols: 7, rows: 5 } as const;

export type LayoutIssue = 'outOfGrid' | 'cellTaken' | 'crossingAlone';

/**
 * Layout rules shared by the seed and the custom spread builder, one entry per broken rule:
 * every cell lies inside `SPREAD_GRID`; a cell holds at most one upright and one crosswise
 * card; and a crosswise card lies over an upright one. Positions without a layout are skipped.
 */
export function spreadLayoutIssues(
  positions: readonly { layout: z.infer<typeof spreadLayoutSchema> | null }[],
): { position: number; issue: LayoutIssue }[] {
  const issues: { position: number; issue: LayoutIssue }[] = [];
  const cells = new Map<string, boolean[]>();
  positions.forEach(({ layout }, i) => {
    if (layout === null) return;
    const { col, row, rotated } = layout;
    if (col >= SPREAD_GRID.cols || row >= SPREAD_GRID.rows) {
      issues.push({ position: i, issue: 'outOfGrid' });
    }
    const cell = `${String(col)},${String(row)}`;
    const taken = cells.get(cell) ?? [];
    if (taken.includes(rotated)) issues.push({ position: i, issue: 'cellTaken' });
    cells.set(cell, [...taken, rotated]);
  });
  positions.forEach(({ layout }, i) => {
    if (!layout?.rotated) return;
    if (!cells.get(`${String(layout.col)},${String(layout.row)}`)?.includes(false)) {
      issues.push({ position: i, issue: 'crossingAlone' });
    }
  });
  return issues;
}

const LAYOUT_ISSUE_MESSAGE: Record<LayoutIssue, string> = {
  outOfGrid: `cell is outside the ${String(SPREAD_GRID.cols)}×${String(SPREAD_GRID.rows)} grid`,
  cellTaken: 'cell already holds a card with the same orientation',
  crossingAlone: 'a crosswise card must lie over an upright one in the same cell',
};

export const spreadSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: text,
    description: text,
    positions: z.array(spreadPositionSchema).min(1),
  })
  .superRefine((spread, ctx) => {
    spread.positions.forEach((position, i) => {
      if (position.index !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `position ${String(i)} must have index ${String(i + 1)}`,
          path: ['positions', i, 'index'],
        });
      }
    });
    for (const { position, issue } of spreadLayoutIssues(spread.positions)) {
      ctx.addIssue({
        code: 'custom',
        message: LAYOUT_ISSUE_MESSAGE[issue],
        path: ['positions', position, 'layout'],
      });
    }
  });

export const spreadsFileSchema = z.strictObject({
  version: z.int().positive(),
  spreads: z
    .array(spreadSchema)
    .min(1)
    .superRefine((spreads, ctx) => {
      const seen = new Set<string>();
      spreads.forEach((spread, i) => {
        if (seen.has(spread.key)) {
          ctx.addIssue({
            code: 'custom',
            message: `duplicate key ${spread.key}`,
            path: [i, 'key'],
          });
        }
        seen.add(spread.key);
      });
    }),
});

export type SeedSpreadPosition = z.infer<typeof spreadPositionSchema>;
export type SeedSpread = z.infer<typeof spreadSchema>;
export type SpreadsFile = z.infer<typeof spreadsFileSchema>;

/** Bundled spread seed, validated at load. */
export const spreadsSeed: SpreadsFile = spreadsFileSchema.parse(raw);
