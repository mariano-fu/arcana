import i18n from '../i18n';
import raw from './cards.es.json';
import {
  cardName,
  cardsFileSchema,
  cardsSeed,
  DECK_SIZE,
  RANKS_PER_SUIT,
  SUITS,
  type Card,
  type CardsFile,
  type Element,
  type Suit,
} from './cards';

const t = i18n.t;
const clone = (): CardsFile => structuredClone(cardsSeed);

function byKey(cards: Card[], key: string): Card {
  const card = cards.find((c) => c.key === key);
  if (!card) throw new Error(`missing ${key}`);
  return card;
}

describe('cards seed', () => {
  const { cards } = cardsSeed;

  it('passes the schema', () => {
    expect(cardsFileSchema.safeParse(raw).success).toBe(true);
  });

  it('has all 78 cards: 22 majors and 14 per suit', () => {
    expect(cards).toHaveLength(78);
    expect(DECK_SIZE).toBe(78);
    expect(cards.filter((c) => c.arcana === 'major').map((c) => c.number)).toEqual(
      Array.from({ length: 22 }, (_, i) => i),
    );
    for (const suit of SUITS) {
      expect(cards.filter((c) => c.suit === suit).map((c) => c.number)).toEqual(
        Array.from({ length: RANKS_PER_SUIT }, (_, i) => i + 1),
      );
    }
  });

  it('has unique keys', () => {
    const keys = cards.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives each minor card its suit element', () => {
    const element: Record<Suit, Element> = {
      wands: 'fire',
      cups: 'water',
      swords: 'air',
      pentacles: 'earth',
    };
    for (const card of cards) {
      if (card.arcana === 'minor') expect(card.element).toBe(element[card.suit]);
    }
  });

  it('maps Golden Dawn courts as GD Knight -> Rey, GD Prince -> Caballero', () => {
    const courts: Record<Suit, [caballero: string, rey: string]> = {
      wands: ['20° Cáncer – 20° Leo', '20° Escorpio – 20° Sagitario'],
      cups: ['20° Libra – 20° Escorpio', '20° Acuario – 20° Piscis'],
      swords: ['20° Capricornio – 20° Acuario', '20° Tauro – 20° Géminis'],
      pentacles: ['20° Aries – 20° Tauro', '20° Leo – 20° Virgo'],
    };
    expect(cardsSeed.astrology_system.id).toBe('golden-dawn-book-t');
    for (const suit of SUITS) {
      expect(byKey(cards, `${suit}-12`).astrology).toBe(courts[suit][0]);
      expect(byKey(cards, `${suit}-14`).astrology).toBe(courts[suit][1]);
      expect(byKey(cards, `${suit}-11`).astrology).toBeNull();
      expect(byKey(cards, `${suit}-01`).astrology).toBeNull();
    }
  });

  it('builds minor names from the es.json rank and suit labels', () => {
    const name = (key: string) => cardName(byKey(cards, key), t);
    expect(name('major-00')).toBe('El Loco');
    expect(name('cups-07')).toBe('Siete de Copas');
    expect(name('wands-01')).toBe('As de Bastos');
    expect(name('pentacles-11')).toBe('Paje de Oros');
    expect(name('swords-14')).toBe('Rey de Espadas');
  });
});

// Meanings address the consultant as "usted" and must not assume a gender. These words are
// masculine-only when they describe a person; ALLOWED_PHRASES lists uses that don't.
const MASCULINE_WORDS = [
  'sí mismo',
  'seguro',
  'quieto',
  'tranquilo',
  'cansado',
  'agotado',
  'atrapado',
  'bloqueado',
  'estancado',
  'aislado',
  'perdido',
  'herido',
  'heridos',
  'solo',
  'listo',
  'dispuesto',
  'preparado',
  'abierto',
  'cerrado',
  'confiado',
  'curioso',
  'soñador',
  'romántico',
  'observador',
  'estudioso',
  'experto',
  'lleno',
  'otros',
  'todos',
  'un líder',
  'un asesor',
];
const ALLOWED_PHRASES = [
  'corazón abierto', // the heart, not the person
  'lugar más tranquilo', // a place
  'solo por lo que', // adverb
];

function masculineWords(text: string): string[] {
  let rest = text.toLowerCase();
  for (const phrase of ALLOWED_PHRASES) rest = rest.replaceAll(phrase, '');
  return MASCULINE_WORDS.filter((word) =>
    new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'u').test(rest),
  );
}

describe('gender-neutral meanings', () => {
  it('detects masculine-only words outside the allowlist', () => {
    expect(masculineWords('Pérdida de fe en sí mismo.')).toContain('sí mismo');
    expect(masculineWords('Se siente seguro y tranquilo.')).toEqual(['seguro', 'tranquilo']);
    expect(masculineWords('Con el corazón abierto, al mismo tiempo.')).toEqual([]);
    expect(masculineWords('Inseguridad y desconfianza.')).toEqual([]);
  });

  it.each(cardsSeed.cards.map((c) => [c.key, c] as const))('%s', (_key, card) => {
    const texts = [card.upright, card.reversed, ...card.keywords];
    expect(texts.flatMap(masculineWords)).toEqual([]);
  });
});

describe('cardsFileSchema', () => {
  it('rejects duplicate keys', () => {
    const file = clone();
    file.cards[1] = { ...byKey(file.cards, 'major-00') };
    expect(cardsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a missing card', () => {
    const file = clone();
    file.cards.pop();
    expect(cardsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a key that does not match suit and number', () => {
    const file = clone();
    byKey(file.cards, 'cups-07').key = 'cups-08';
    expect(cardsFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects empty meanings and keyword lists', () => {
    const empty = clone();
    byKey(empty.cards, 'major-00').upright = '  ';
    expect(cardsFileSchema.safeParse(empty).success).toBe(false);

    const noKeywords = clone();
    byKey(noKeywords.cards, 'major-00').keywords = [];
    expect(cardsFileSchema.safeParse(noKeywords).success).toBe(false);
  });

  it('rejects a stored name on a minor card', () => {
    const file = clone();
    Object.assign(byKey(file.cards, 'cups-07'), { name: 'Siete de Copas' });
    expect(cardsFileSchema.safeParse(file).success).toBe(false);
  });
});
