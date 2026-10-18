// Renders the card seed as a Markdown review document (docs/review/cards-es.md), grouped by
// arcana and suit, one section per card, so the texts can be read and corrected on a phone.

import i18next, { type TFunction } from 'i18next';

import es from '../src/i18n/locales/es.json' with { type: 'json' };
import { cardName, SUITS, type Card, type CardsFile } from '../src/seed/cards.ts';

export const REVIEW_DOC_PATH = new URL('../../docs/review/cards-es.md', import.meta.url);

/** A standalone i18next `t` for Node: the app's i18n module pulls in React. */
export function createReviewT(): TFunction {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'es',
    resources: { es: { translation: es } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return i18n.t;
}

function cardSection(card: Card, t: TFunction): string {
  const title =
    card.arcana === 'major' ? `${String(card.number)} · ${cardName(card, t)}` : cardName(card, t);
  const element = card.element === null ? '—' : t(`cards.element.${card.element}`);
  return [
    `### ${title}`,
    '',
    `\`${card.key}\` · ${t('cards.field.element')}: ${element} · ${t('cards.field.astrology')}: ${card.astrology ?? '—'}`,
    '',
    `**${t('cards.field.keywords')}:** ${card.keywords.join(', ')}`,
    '',
    `**${t('cards.field.upright')}:** ${card.upright}`,
    '',
    `**${t('cards.field.reversed')}:** ${card.reversed}`,
    '',
    `**${t('cards.review.corrections')}:**`,
    '',
  ].join('\n');
}

export function renderCardsReview(seed: CardsFile, t: TFunction): string {
  const groups: { heading: string; cards: Card[] }[] = [
    { heading: t('cards.arcana.major'), cards: seed.cards.filter((c) => c.arcana === 'major') },
    ...SUITS.map((suit) => ({
      heading: `${t('cards.arcana.minor')}: ${t(`cards.suit.${suit}`)}`,
      cards: seed.cards.filter((c) => c.arcana === 'minor' && c.suit === suit),
    })),
  ];

  const parts = [
    `# ${t('cards.review.title')}`,
    '',
    t('cards.review.intro'),
    '',
    `_${t('cards.review.generated', { version: seed.version })}_`,
    '',
  ];
  for (const group of groups) {
    const sorted = [...group.cards].sort((a, b) => a.number - b.number);
    parts.push(`## ${group.heading}`, '', ...sorted.map((card) => cardSection(card, t)));
  }
  return parts.join('\n');
}
