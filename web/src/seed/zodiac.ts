// Zodiac sign profile seed: schema, types and the parsed `zodiac.es.json`.
//
// Western tropical zodiac. `start`/`end` are the standard date table (inclusive), for display
// only: ingress days vary by year, so `sunSign` (astro/) always computes the Sun's longitude.
//
// `ruler` is the modern ruler (Pluto, Uranus and Neptune for Escorpio, Acuario and Piscis);
// `traditional_ruler` is the classical one, limited to the seven visible planets.
// `compatible` follows the element rule: same element plus the complementary one
// (fire ↔ air, earth ↔ water). `challenging` lists the two square signs: same modality, three
// signs away, with an element that is neither its own nor the complementary one.

import { z } from 'zod';

import { ELEMENTS } from './cards.ts';
import raw from './zodiac.es.json' with { type: 'json' };

export const SIGN_KEYS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const;
export const MODALITIES = ['cardinal', 'fixed', 'mutable'] as const;
export const CLASSICAL_PLANETS = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
] as const;
export const PLANETS = [...CLASSICAL_PLANETS, 'uranus', 'neptune', 'pluto'] as const;

const signKeySchema = z.enum(SIGN_KEYS);
const planetSchema = z.enum(PLANETS);
const text = z.string().trim().min(1);

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const monthDaySchema = z
  .strictObject({
    month: z.int().min(1).max(12),
    day: z.int().min(1).max(31),
  })
  .refine(({ month, day }) => day <= (DAYS_IN_MONTH[month - 1] ?? 0), {
    message: 'day does not exist in that month',
    path: ['day'],
  });

export const signSchema = z.strictObject({
  key: signKeySchema,
  number: z.int().min(1).max(SIGN_KEYS.length),
  name: text,
  glyph: text,
  start: monthDaySchema,
  end: monthDaySchema,
  element: z.enum(ELEMENTS),
  modality: z.enum(MODALITIES),
  ruler: planetSchema,
  traditional_ruler: z.enum(CLASSICAL_PLANETS),
  traits: z.array(text).min(1),
  description: text,
  compatible: z.array(signKeySchema).min(1),
  challenging: z.array(signKeySchema).length(2),
});

export const zodiacFileSchema = z.strictObject({
  version: z.int().positive(),
  signs: z
    .array(signSchema)
    .length(SIGN_KEYS.length)
    .superRefine((signs, ctx) => {
      signs.forEach((sign, i) => {
        if (sign.key !== SIGN_KEYS[i] || sign.number !== i + 1) {
          ctx.addIssue({
            code: 'custom',
            message: `sign ${String(i)} must be ${String(SIGN_KEYS[i])} with number ${String(i + 1)}`,
            path: [i, 'key'],
          });
        }
        if (sign.compatible.includes(sign.key)) {
          ctx.addIssue({
            code: 'custom',
            message: `${sign.key} lists itself as compatible`,
            path: [i, 'compatible'],
          });
        }
        if (sign.challenging.includes(sign.key)) {
          ctx.addIssue({
            code: 'custom',
            message: `${sign.key} lists itself as challenging`,
            path: [i, 'challenging'],
          });
        }
        for (const other of sign.challenging) {
          if (sign.compatible.includes(other)) {
            ctx.addIssue({
              code: 'custom',
              message: `${sign.key} lists ${other} as both compatible and challenging`,
              path: [i, 'challenging'],
            });
          }
          if (!signs.find((s) => s.key === other)?.challenging.includes(sign.key)) {
            ctx.addIssue({
              code: 'custom',
              message: `${other} must list ${sign.key} as challenging too`,
              path: [i, 'challenging'],
            });
          }
        }
      });
    }),
});

export type SignKey = z.infer<typeof signKeySchema>;
export type Modality = (typeof MODALITIES)[number];
export type Planet = z.infer<typeof planetSchema>;
export type MonthDay = z.infer<typeof monthDaySchema>;
export type Sign = z.infer<typeof signSchema>;
export type ZodiacFile = z.infer<typeof zodiacFileSchema>;

/** Bundled zodiac seed, validated at load. */
export const zodiacSeed: ZodiacFile = zodiacFileSchema.parse(raw);
