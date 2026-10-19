import { e_tilt, MakeTime } from 'astronomy-engine';

import { ascendantAndHouses, signForLongitude, toUtc } from '.';
import reference from './fixtures/houses-reference.json';
import { lastInstantBeforeIngress } from './test-utils.ts';

/** Smallest angle between two longitudes, in degrees. */
const angularDistance = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
};

/** Degrees from `from` to `to`, going forward through the zodiac, in [0, 360). */
const forward = (from: number, to: number) => (((to - from) % 360) + 360) % 360;

/** Degrees. The implementation matches the reference to ~0.0001°. */
const TOLERANCE = 0.01;

const placidusCases = reference.cases.filter((c) => c.cusps !== undefined);
const fallbackCases = reference.cases.filter((c) => c.cusps === undefined);

describe('ascendantAndHouses against the Swiss Ephemeris reference', () => {
  it('covers Costa Rica, the Southern hemisphere and a polar fallback', () => {
    expect(reference.cases.length).toBeGreaterThanOrEqual(10);
    expect(reference.cases.some((c) => c.tz === 'America/Costa_Rica')).toBe(true);
    expect(reference.cases.some((c) => c.lat < 0)).toBe(true);
    expect(fallbackCases.length).toBeGreaterThan(0);
  });

  it.each(reference.cases)('$label: the fixture UTC matches toUtc', ({ date, time, tz, utc }) => {
    expect(toUtc(date, time, tz).utc).toEqual(new Date(utc));
  });

  describe.each(placidusCases)('$label', ({ utc, lat, lng, ascendant, mc, cusps }) => {
    const result = ascendantAndHouses(new Date(utc), lat, lng);

    it('uses Placidus', () => {
      expect(result.system).toBe('placidus');
    });

    it('has the ascendant and MC within 0.01°', () => {
      expect(angularDistance(result.ascendant.longitude, ascendant)).toBeLessThan(TOLERANCE);
      expect(angularDistance(result.mc.longitude, mc)).toBeLessThan(TOLERANCE);
    });

    const errors = result.cusps.map((cusp, i) =>
      angularDistance(cusp.longitude, cusps[i] ?? Number.NaN),
    );

    it.each(Array.from({ length: 12 }, (_, i) => i + 1))('has cusp %i within 0.01°', (house) => {
      expect(errors[house - 1]).toBeLessThan(TOLERANCE);
    });
  });

  describe.each(fallbackCases)('$label', ({ utc, lat, lng, ascendant, mc }) => {
    const result = ascendantAndHouses(new Date(utc), lat, lng);

    it('falls back to whole-sign', () => {
      expect(result.system).toBe('whole-sign');
    });

    it('has the ascendant and MC within 0.01°', () => {
      expect(angularDistance(result.ascendant.longitude, ascendant)).toBeLessThan(TOLERANCE);
      expect(angularDistance(result.mc.longitude, mc)).toBeLessThan(TOLERANCE);
    });

    it("starts the 1st house at 0° of the ascendant's sign, one sign per house", () => {
      const first = Math.floor(result.ascendant.longitude / 30) * 30;
      expect(result.cusps.map((cusp) => cusp.longitude)).toEqual(
        Array.from({ length: 12 }, (_, i) => (first + i * 30) % 360),
      );
      expect(result.cusps[0]?.sign).toBe(result.ascendant.sign);
    });
  });
});

describe('ascendantAndHouses', () => {
  const utc = new Date('1987-04-12T14:15:00Z');

  it('keeps Placidus cusps consistent: angles, opposites and zodiac order', () => {
    const { ascendant, mc, cusps } = ascendantAndHouses(utc, 9.9333, -84.0833);
    const longitudes = cusps.map((cusp) => cusp.longitude);
    expect(longitudes).toHaveLength(12);
    expect(longitudes[0]).toBe(ascendant.longitude);
    expect(longitudes[9]).toBe(mc.longitude);
    longitudes.slice(0, 6).forEach((longitude, i) => {
      expect(angularDistance(longitude, longitudes[i + 6] ?? Number.NaN)).toBeCloseTo(180, 9);
    });
    const steps = longitudes.map((longitude, i) =>
      forward(longitude, longitudes[(i + 1) % 12] ?? Number.NaN),
    );
    steps.forEach((step) => {
      expect(step).toBeGreaterThan(0);
    });
    expect(steps.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 9);
  });

  it('returns sign and degree consistent with each longitude', () => {
    const { ascendant, mc, cusps } = ascendantAndHouses(utc, -34.6037, -58.3816);
    for (const { longitude, sign, degree } of [ascendant, mc, ...cusps]) {
      expect(longitude).toBeGreaterThanOrEqual(0);
      expect(longitude).toBeLessThan(360);
      expect(sign).toBe(signForLongitude(longitude));
      expect(degree).toBeCloseTo(longitude % 30, 10);
    }
  });

  it('switches to whole-sign exactly at the polar circle (90° − true obliquity)', () => {
    const polarCircle = 90 - e_tilt(MakeTime(utc)).tobl;
    for (const sign of [1, -1]) {
      expect(ascendantAndHouses(utc, sign * (polarCircle - 0.01), 0).system).toBe('placidus');
      expect(ascendantAndHouses(utc, sign * polarCircle, 0).system).toBe('whole-sign');
      expect(ascendantAndHouses(utc, sign * 90, 0).system).toBe('whole-sign');
    }
  });

  it('always puts the ascendant east of the MC, within 180° after it', () => {
    for (let hour = 0; hour < 24; hour++) {
      const instant = new Date(Date.UTC(2012, 11, 21, hour));
      for (const lat of [-80, -60, 0, 45, 69.6492, 80]) {
        const { ascendant, mc } = ascendantAndHouses(instant, lat, 18.9553);
        const distance = forward(mc.longitude, ascendant.longitude);
        expect(distance).toBeGreaterThan(0);
        expect(distance).toBeLessThan(180);
      }
    }
  });

  it('rejects invalid input', () => {
    expect(() => ascendantAndHouses(new Date(Number.NaN), 0, 0)).toThrow(RangeError);
    expect(() => ascendantAndHouses(utc, 91, 0)).toThrow(RangeError);
    expect(() => ascendantAndHouses(utc, Number.NaN, 0)).toThrow(RangeError);
    expect(() => ascendantAndHouses(utc, 0, 181)).toThrow(RangeError);
  });
});

describe('ascendantAndHouses at sign boundaries', () => {
  // San José, Costa Rica, 1991-02-04 ~02:40Z: Asc ≈ 29°41′ Virgo, cusp 11 ≈ 28°49′ Cancer.
  const [lat, lng] = [9.9333, -84.0833];
  const from = new Date('1991-02-04T02:40:00Z');
  const to = new Date('1991-02-04T03:00:00Z');
  const cusp11 = (utc: Date) => {
    const cusp = ascendantAndHouses(utc, lat, lng).cusps[10];
    if (cusp === undefined) throw new Error('missing cusp 11');
    return cusp;
  };

  it.each([
    ['ascendant', 'virgo', 'libra', (utc: Date) => ascendantAndHouses(utc, lat, lng).ascendant],
    ['cusp 11', 'cancer', 'leo', cusp11],
  ] as const)(
    'keeps the %s in %s with degree < 30 just before %s',
    (_, before, after, position) => {
      const instant = lastInstantBeforeIngress(position, from, to);
      const last = position(instant);
      expect(last.sign).toBe(before);
      expect(last.degree).toBeGreaterThan(29.999);
      expect(last.degree).toBeLessThan(30);
      const next = position(new Date(instant.getTime() + 1));
      expect(next.sign).toBe(after);
      expect(next.degree).toBeLessThan(0.001);
    },
  );
});
