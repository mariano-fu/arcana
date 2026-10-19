import { moonLongitude, moonSignUncertain, PLANET_KEYS, planetPositions } from '.';
import reference from './fixtures/horizons-reference.json';

/** Smallest angle between two longitudes, in degrees. */
const angularDistance = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
};

// Moon ingresses (Horizons, geocentric apparent ecliptic of date), rounded to the minute:
// 2024-03-07 ~00:38:30Z Capricorn → Aquarius (300°), 2024-03-09 ~01:03:20Z Aquarius → Pisces
// (330°), 2018-11-04 ~09:01Z Virgo → Libra (180°).

describe('planetPositions against JPL Horizons', () => {
  it('uses at least 10 reference instants spread across 1950–2030', () => {
    const years = reference.cases.map((c) => Number(c.utc.slice(0, 4)));
    expect(years.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...years)).toBeLessThanOrEqual(1950);
    expect(Math.max(...years)).toBeGreaterThanOrEqual(2030);
  });

  describe.each(reference.cases)('at $utc', ({ utc, longitudes }) => {
    const positions = planetPositions(new Date(utc));

    it.each(PLANET_KEYS)('%s is within 1° of the reference', (planet) => {
      expect(angularDistance(positions[planet].longitude, longitudes[planet])).toBeLessThan(1);
    });
  });
});

describe('planetPositions', () => {
  it('returns every planet with a sign and degree consistent with its longitude', () => {
    const positions = planetPositions(new Date('2000-01-01T12:00:00Z'));
    expect(Object.keys(positions)).toEqual([...PLANET_KEYS]);
    for (const { longitude, sign, degree } of Object.values(positions)) {
      expect(longitude).toBeGreaterThanOrEqual(0);
      expect(longitude).toBeLessThan(360);
      expect(degree).toBeGreaterThanOrEqual(0);
      expect(degree).toBeLessThan(30);
      expect(degree).toBeCloseTo(longitude % 30, 10);
      expect(sign).toBeTypeOf('string');
    }
  });

  it('gives the Moon its sign and degree on both sides of an ingress', () => {
    expect(planetPositions(new Date('2024-03-07T00:30:00Z')).moon).toMatchObject({
      sign: 'capricorn',
    });
    const after = planetPositions(new Date('2024-03-07T00:50:00Z')).moon;
    expect(after.sign).toBe('aquarius');
    expect(after.degree).toBeLessThan(1);
  });

  it('keeps the Sun just before the March equinox in Pisces, near 360°', () => {
    const { sun } = planetPositions(new Date('2024-03-20T02:00:00Z'));
    expect(sun.sign).toBe('pisces');
    expect(sun.longitude).toBeGreaterThan(359);
    expect(sun.degree).toBeGreaterThan(29);
  });

  it('rejects an invalid Date', () => {
    expect(() => planetPositions(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => moonLongitude(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('moonSignUncertain', () => {
  it('uses the local day: the same ingress falls on different dates by timezone', () => {
    // 2024-03-07 00:38Z is March 6, 18:38 in Costa Rica and March 7, 09:38 in Tokyo.
    expect(moonSignUncertain('2024-03-06', 'America/Costa_Rica')).toBe(true);
    expect(moonSignUncertain('2024-03-07', 'America/Costa_Rica')).toBe(false);
    expect(moonSignUncertain('2024-03-06', 'Asia/Tokyo')).toBe(false);
    expect(moonSignUncertain('2024-03-07', 'Asia/Tokyo')).toBe(true);
  });

  it('respects the exact local midnight', () => {
    // 2024-03-09 01:03Z is 00:03 on March 9 in the Azores (UTC−1 in winter).
    expect(moonSignUncertain('2024-03-08', 'Atlantic/Azores')).toBe(false);
    expect(moonSignUncertain('2024-03-09', 'Atlantic/Azores')).toBe(true);
  });

  it('handles a day that starts in a DST gap at midnight', () => {
    // São Paulo skipped 2018-11-04 00:00–01:00; the ingress is at 07:01 local that day.
    expect(moonSignUncertain('2018-11-03', 'America/Sao_Paulo')).toBe(false);
    expect(moonSignUncertain('2018-11-04', 'America/Sao_Paulo')).toBe(true);
    expect(moonSignUncertain('2018-11-05', 'America/Sao_Paulo')).toBe(false);
  });

  it('rejects an invalid date or timezone', () => {
    expect(() => moonSignUncertain('2024-02-30', 'America/Costa_Rica')).toThrow(RangeError);
    expect(() => moonSignUncertain('2024-03-07', 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});
