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

export const spreadSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: text,
    description: text,
    positions: z.array(spreadPositionSchema).min(1),
  })
  .superRefine((spread, ctx) => {
    const cells = new Map<string, boolean[]>();
    spread.positions.forEach((position, i) => {
      if (position.index !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `position ${String(i)} must have index ${String(i + 1)}`,
          path: ['positions', i, 'index'],
        });
      }
      const { col, row, rotated } = position.layout;
      const cell = `${String(col)},${String(row)}`;
      const taken = cells.get(cell) ?? [];
      if (taken.includes(rotated)) {
        ctx.addIssue({
          code: 'custom',
          message: `cell ${cell} already holds a${rotated ? ' rotated' : 'n upright'} card`,
          path: ['positions', i, 'layout'],
        });
      }
      cells.set(cell, [...taken, rotated]);
    });
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
