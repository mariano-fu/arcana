import type { TFunction } from 'i18next';

import { cardName, cardsSeed, SUITS, type Card } from '../../seed/cards';

/** The picker's browse tabs: the majors, then one per suit. */
export const CARD_GROUPS = ['major', ...SUITS] as const;
export type CardGroup = (typeof CARD_GROUPS)[number];

const byKey = new Map(cardsSeed.cards.map((card) => [card.key, card]));

/** The seed card for a key; undefined for a key the bundled deck doesn't have. */
export function cardByKey(key: string): Card | undefined {
  return byKey.get(key);
}

/** Cards of one browse tab, in deck order (majors 0–21; suits As to Rey). */
export function cardsInGroup(group: CardGroup): Card[] {
  return cardsSeed.cards.filter((card) =>
    group === 'major' ? card.arcana === 'major' : card.suit === group,
  );
}

/** Lowercase, without accents, so "enamorados" finds "Los Enamorados" and "pagina" "Página". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Cards matching what she typed, in deck order: a number matches every card with that number
 * (major XVII, the sevens), anything else matches cards whose name contains every word.
 */
export function searchCards(query: string, t: TFunction): Card[] {
  const folded = foldText(query);
  if (folded === '') return [];
  if (/^\d+$/.test(folded)) {
    const number = Number(folded);
    return cardsSeed.cards.filter((card) => card.number === number);
  }
  const words = folded.split(/\s+/);
  return cardsSeed.cards.filter((card) => {
    const name = foldText(cardName(card, t));
    return words.every((word) => name.includes(word));
  });
}
