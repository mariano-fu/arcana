import es from '../i18n/locales/es.json';
import { masculineWords } from '../test/gender-neutral';
import { healthClaims } from '../test/health-claims';
import { ELEMENTS, type Element } from './cards';
import raw from './zodiac.es.json';
import {
  MODALITIES,
  PLANETS,
  SIGN_KEYS,
  zodiacFileSchema,
  zodiacSeed,
  type MonthDay,
  type Sign,
  type SignKey,
  type ZodiacFile,
} from './zodiac';

const clone = (): ZodiacFile => structuredClone(zodiacSeed);

function at(file: ZodiacFile, i: number): Sign {
  const sign = file.signs[i];
  if (!sign) throw new Error(`missing sign ${String(i)}`);
  return sign;
}

/** Issue messages from parsing `file`; empty when it is valid. */
const issues = (file: ZodiacFile): string[] =>
  zodiacFileSchema.safeParse(file).error?.issues.map((i) => i.message) ?? [];

const ordinal = ({ month, day }: MonthDay) => month * 100 + day;

/** Whether `date` falls in the sign's inclusive range, which may wrap past 31 Dec. */
function inRange(sign: Sign, date: MonthDay): boolean {
  const [start, end, d] = [ordinal(sign.start), ordinal(sign.end), ordinal(date)];
  return start <= end ? d >= start && d <= end : d >= start || d <= end;
}

const COMPLEMENT: Record<Element, Element> = {
  fire: 'air',
  air: 'fire',
  earth: 'water',
  water: 'earth',
};

describe('zodiac seed', () => {
  it('passes the schema', () => {
    expect(zodiacFileSchema.safeParse(raw).success).toBe(true);
  });

  it('has the 12 signs in zodiac order', () => {
    expect(zodiacSeed.signs.map((s) => s.key)).toEqual(SIGN_KEYS);
    expect(zodiacSeed.signs.map((s) => s.number)).toEqual(SIGN_KEYS.map((_, i) => i + 1));
  });

  it('covers every day of a leap year exactly once', () => {
    const date = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 366; i++) {
      const day = { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      const matches = zodiacSeed.signs.filter((s) => inRange(s, day)).map((s) => s.key);
      expect(matches, `${String(day.day)}/${String(day.month)}`).toHaveLength(1);
      date.setUTCDate(date.getUTCDate() + 1);
    }
  });

  it('uses the standard date table', () => {
    const aries = at(zodiacSeed, 0);
    const capricorn = at(zodiacSeed, 9);
    expect([aries.start, aries.end]).toEqual([
      { month: 3, day: 21 },
      { month: 4, day: 19 },
    ]);
    expect([capricorn.start, capricorn.end]).toEqual([
      { month: 12, day: 22 },
      { month: 1, day: 19 },
    ]);
  });

  it('cycles elements fire → earth → air → water and modalities cardinal → fixed → mutable', () => {
    zodiacSeed.signs.forEach((sign, i) => {
      expect(sign.element).toBe(['fire', 'earth', 'air', 'water'][i % 4]);
      expect(sign.modality).toBe(MODALITIES[i % 3]);
    });
  });

  it('stores modern and traditional rulers', () => {
    const rulers = Object.fromEntries(
      zodiacSeed.signs.map((s) => [s.key, [s.ruler, s.traditional_ruler]]),
    );
    expect(rulers).toMatchObject({
      aries: ['mars', 'mars'],
      cancer: ['moon', 'moon'],
      leo: ['sun', 'sun'],
      scorpio: ['pluto', 'mars'],
      aquarius: ['uranus', 'saturn'],
      pisces: ['neptune', 'jupiter'],
    });
  });

  it('lists as compatible the same and complementary element, symmetrically', () => {
    const byKey = new Map(zodiacSeed.signs.map((s) => [s.key, s]));
    for (const sign of zodiacSeed.signs) {
      const expected = zodiacSeed.signs
        .filter((o) => o.key !== sign.key)
        .filter((o) => o.element === sign.element || o.element === COMPLEMENT[sign.element])
        .map((o) => o.key);
      expect([...sign.compatible].sort()).toEqual([...expected].sort());
      for (const other of sign.compatible) {
        expect(byKey.get(other)?.compatible).toContain(sign.key);
      }
    }
  });

  it('lists as challenging the two square signs, symmetrically and never as compatible', () => {
    zodiacSeed.signs.forEach((sign, i) => {
      const squares = [3, 9].map((offset) => SIGN_KEYS[(i + offset) % SIGN_KEYS.length]);
      expect([...sign.challenging].sort()).toEqual(squares.sort());
      expect(sign.challenging).not.toContain(sign.key);
      for (const other of sign.challenging) {
        expect(sign.compatible).not.toContain(other);
        expect(zodiacSeed.signs.find((s) => s.key === other)?.challenging).toContain(sign.key);
      }
    });
    expect(at(zodiacSeed, 0).challenging).toEqual(['cancer', 'capricorn']);
  });

  it('has a Spanish label for every modality, planet and element', () => {
    for (const m of MODALITIES) expect(es.zodiac.modality[m]).toBeTruthy();
    for (const p of PLANETS) expect(es.astro.planet[p]).toBeTruthy();
    for (const e of ELEMENTS) expect(es.cards.element[e]).toBeTruthy();
    expect(es.zodiac.field.challenging).toBe('Signos desafiantes');
  });
});

describe('zodiac schema', () => {
  it('rejects a sign out of order', () => {
    const file = clone();
    [file.signs[0], file.signs[1]] = [at(file, 1), at(file, 0)];
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects an impossible date', () => {
    const file = clone();
    at(file, 0).end = { month: 4, day: 31 };
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a sign compatible with itself', () => {
    const file = clone();
    at(file, 0).compatible.push('aries');
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects an unknown compatible sign', () => {
    const file = clone();
    at(file, 0).compatible.push('ophiuchus' as SignKey);
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a challenging list without exactly 2 signs', () => {
    const file = clone();
    at(file, 0).challenging.push('libra');
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });

  it('rejects a sign challenging itself', () => {
    const file = clone();
    at(file, 0).challenging = ['aries', 'cancer'];
    expect(issues(file)).toContain('aries lists itself as challenging');
  });

  it('rejects an asymmetric challenging relation', () => {
    const file = clone();
    at(file, 0).challenging = ['cancer', 'virgo'];
    expect(issues(file)).toContain('virgo must list aries as challenging too');
  });

  it('rejects a sign both compatible and challenging', () => {
    const file = clone();
    const aries = at(file, 0);
    aries.challenging = ['cancer', 'leo'];
    expect(issues(file)).toContain('aries lists leo as both compatible and challenging');
  });

  it('rejects an outer planet as traditional ruler', () => {
    const file = clone();
    (at(file, 7) as { traditional_ruler: string }).traditional_ruler = 'pluto';
    expect(zodiacFileSchema.safeParse(file).success).toBe(false);
  });
});

describe('gender-neutral texts', () => {
  it('uses no masculine-only words about people', () => {
    const texts = zodiacSeed.signs.flatMap((s) => [s.description, ...s.traits]);
    expect(texts.flatMap(masculineWords)).toEqual([]);
  });
});

describe('health claims', () => {
  it('makes no health or medical claims', () => {
    expect(zodiacSeed.signs).toHaveLength(12);
    const claims = zodiacSeed.signs.flatMap((s) =>
      [s.name, ...s.traits, s.description].flatMap((t) =>
        healthClaims(t).map((w) => `${s.key}: ${w}`),
      ),
    );
    expect(claims).toEqual([]);
  });
});
