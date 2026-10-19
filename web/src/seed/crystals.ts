// Crystal library seed: schema, types and the parsed `crystals.es.json`.
//
// Recommendation reference only: no stock, price or quantity fields (future inventory lives in
// a separate `crystal_stock` table). Colors, chakras and intentions are keys; their Spanish
// labels live in `es.json` (`crystals.color.*`, `crystals.chakra.*`, `crystals.intention.*`).
// Intentions name what the person seeks ("calma", "abundancia"), never a problem. Signs are the
// zodiac seed's keys. Texts describe associations and traditional uses, never health claims.

import { z } from 'zod';

import raw from './crystals.es.json' with { type: 'json' };
import { SIGN_KEYS } from './zodiac.ts';

/** The seven main chakras, root to crown. */
export const CHAKRAS = [
  'root',
  'sacral',
  'solarPlexus',
  'heart',
  'throat',
  'thirdEye',
  'crown',
] as const;
export const COLORS = [
  'white',
  'clear',
  'pink',
  'red',
  'orange',
  'yellow',
  'gold',
  'green',
  'blue',
  'purple',
  'brown',
  'black',
  'grey',
  'silver',
  'multicolor',
] as const;
/** Seed intention tag keys. She can add her own tags in the app. */
export const INTENTIONS = [
  'calm',
  'rest',
  'love',
  'selfLove',
  'protection',
  'abundance',
  'confidence',
  'clarity',
  'focus',
  'creativity',
  'intuition',
  'grounding',
  'balance',
  'communication',
  'joy',
  'motivation',
  'transformation',
  'newBeginnings',
  'energyCleansing',
  'spirituality',
] as const;

const text = z.string().trim().min(1);

/** A non-empty list of `values` with no repeats. */
const uniqueList = <T extends string>(values: z.ZodEnum<Record<T, T>>) =>
  z
    .array(values)
    .min(1)
    .refine((list) => new Set(list).size === list.length, { message: 'duplicate entries' });

export const seedCrystalSchema = z.strictObject({
  key: z.string().regex(/^[a-z]+(-[a-z]+)*$/),
  name: text,
  colors: uniqueList(z.enum(COLORS)),
  chakras: uniqueList(z.enum(CHAKRAS)),
  signs: uniqueList(z.enum(SIGN_KEYS)),
  intentions: uniqueList(z.enum(INTENTIONS)),
  description: text,
  care: text,
});

export const crystalsFileSchema = z.strictObject({
  version: z.int().positive(),
  crystals: z
    .array(seedCrystalSchema)
    .min(1)
    .superRefine((crystals, ctx) => {
      for (const field of ['key', 'name'] as const) {
        const seen = new Set<string>();
        crystals.forEach((crystal, i) => {
          if (seen.has(crystal[field])) {
            ctx.addIssue({
              code: 'custom',
              message: `duplicate ${field} ${crystal[field]}`,
              path: [i, field],
            });
          }
          seen.add(crystal[field]);
        });
      }
    }),
});

export type Chakra = (typeof CHAKRAS)[number];
export type CrystalColor = (typeof COLORS)[number];
export type IntentionKey = (typeof INTENTIONS)[number];
export type SeedCrystal = z.infer<typeof seedCrystalSchema>;
export type CrystalsFile = z.infer<typeof crystalsFileSchema>;

/** Bundled crystal seed, validated at load. */
export const crystalsSeed: CrystalsFile = crystalsFileSchema.parse(raw);
