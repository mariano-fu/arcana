// Tarot card seed: schema, types and the parsed `cards.es.json`.
//
// Astrology follows the Golden Dawn correspondences. Majors: planet or sign; the three
// "mother letter" cards (El Loco, El Colgado, El Juicio) carry only their element, and
// planetary majors have no element. Minors 2-10: decan. Aces and Pajes: none. Court cards
// follow the visual RWS convention: Caballero (on horseback) takes the range of the mounted
// Golden Dawn Knight, Rey takes the Golden Dawn Prince's, Reina the Queen's.
//
// Minor card names are not stored here: they are built from the rank and suit labels in
// es.json (see `cardName`), so renaming a suit or court rank is a one-line edit.

import type { TFunction } from 'i18next';
import { z } from 'zod';

import type es from '../i18n/locales/es.json';
import raw from './cards.es.json' with { type: 'json' };

export const SUITS = ['wands', 'cups', 'swords', 'pentacles'] as const;
export const ELEMENTS = ['fire', 'water', 'air', 'earth'] as const;
export const MAJOR_COUNT = 22;
export const RANKS_PER_SUIT = 14;
export const DECK_SIZE = MAJOR_COUNT + SUITS.length * RANKS_PER_SUIT;

const suitSchema = z.enum(SUITS);
export type Suit = z.infer<typeof suitSchema>;
const elementSchema = z.enum(ELEMENTS);
const text = z.string().trim().min(1);

const cardText = {
  astrology: text.nullable(),
  keywords: z.array(text).min(1),
  upright: text,
  reversed: text,
};

const majorCardSchema = z.strictObject({
  key: z.string().regex(/^major-\d{2}$/),
  arcana: z.literal('major'),
  number: z
    .int()
    .min(0)
    .max(MAJOR_COUNT - 1),
  name: text,
  suit: z.null(),
  element: elementSchema.nullable(),
  ...cardText,
});

const minorCardSchema = z.strictObject({
  key: z.string().regex(/^(wands|cups|swords|pentacles)-\d{2}$/),
  arcana: z.literal('minor'),
  number: z.int().min(1).max(RANKS_PER_SUIT),
  suit: suitSchema,
  element: elementSchema,
  ...cardText,
});

/** The key a card must have, e.g. `major-00`, `cups-07`. */
export function expectedCardKey(card: { number: number; suit: Suit | null }): string {
  return `${card.suit ?? 'major'}-${String(card.number).padStart(2, '0')}`;
}

export const cardSchema = z
  .discriminatedUnion('arcana', [majorCardSchema, minorCardSchema])
  .refine((card) => card.key === expectedCardKey(card), {
    message: 'key does not match arcana, suit and number',
    path: ['key'],
  });

export const cardsFileSchema = z.strictObject({
  version: z.int().positive(),
  cards: z
    .array(cardSchema)
    .length(DECK_SIZE)
    .superRefine((cards, ctx) => {
      const seen = new Set<string>();
      cards.forEach((card, i) => {
        if (seen.has(card.key)) {
          ctx.addIssue({ code: 'custom', message: `duplicate key ${card.key}`, path: [i, 'key'] });
        }
        seen.add(card.key);
      });
    }),
});

export type Element = z.infer<typeof elementSchema>;
export type MajorCard = z.infer<typeof majorCardSchema>;
export type MinorCard = z.infer<typeof minorCardSchema>;
export type Card = z.infer<typeof cardSchema>;
export type CardsFile = z.infer<typeof cardsFileSchema>;

type RankKey = keyof typeof es.cards.rank;

/** Display name: the seed name for majors, "<rango> de <palo>" from es.json for minors. */
export function cardName(card: Card, t: TFunction): string {
  if (card.arcana === 'major') return card.name;
  return t('cards.minorName', {
    rank: t(`cards.rank.${String(card.number) as RankKey}`),
    suit: t(`cards.suit.${card.suit}`),
  });
}

/** Bundled card seed, validated at load. */
export const cardsSeed: CardsFile = cardsFileSchema.parse(raw);
