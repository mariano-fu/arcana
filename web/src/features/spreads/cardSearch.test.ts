import i18n from 'i18next';

import { cardByKey, cardsInGroup, CARD_GROUPS, foldText, searchCards } from './cardSearch';

const t = i18n.t.bind(i18n);
const keys = (cards: { key: string }[]) => cards.map((card) => card.key);

describe('card groups', () => {
  it('splits the deck into 22 majors and 14 cards per suit, in order', () => {
    expect(cardsInGroup('major')).toHaveLength(22);
    expect(cardsInGroup('major')[0]?.key).toBe('major-00');
    for (const group of CARD_GROUPS.slice(1)) {
      const cards = cardsInGroup(group);
      expect(keys(cards)).toEqual(
        Array.from({ length: 14 }, (_, i) => `${group}-${String(i + 1).padStart(2, '0')}`),
      );
    }
  });

  it('looks cards up by key', () => {
    expect(cardByKey('cups-07')?.suit).toBe('cups');
    expect(cardByKey('cups-15')).toBeUndefined();
  });
});

describe('searchCards', () => {
  it('ignores accents and case', () => {
    expect(foldText('  Página ')).toBe('pagina');
    expect(keys(searchCards('enamorados', t))).toEqual(['major-06']);
    expect(keys(searchCards('JUICIO', t))).toEqual(['major-20']);
  });

  it('matches every word of a minor name', () => {
    expect(keys(searchCards('reina copas', t))).toEqual(['cups-13']);
    expect(keys(searchCards('as de oros', t))).toEqual(['pentacles-01']);
  });

  it('matches a number against majors and minors', () => {
    expect(keys(searchCards('7', t))).toEqual([
      'major-07',
      'wands-07',
      'cups-07',
      'swords-07',
      'pentacles-07',
    ]);
    expect(keys(searchCards('0', t))).toEqual(['major-00']);
    expect(keys(searchCards('17', t))).toEqual(['major-17']);
  });

  it('finds nothing for an empty or unknown query', () => {
    expect(searchCards('   ', t)).toEqual([]);
    expect(searchCards('dragón', t)).toEqual([]);
  });
});
