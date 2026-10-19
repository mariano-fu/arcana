import { signForLongitude, sunLongitude, sunSign } from '.';

const MINUTE_MS = 60 * 1000;
const at = (iso: string, offsetMinutes = 0) =>
  new Date(Date.parse(iso) + offsetMinutes * MINUTE_MS);

// Ingress instants (equinoxes/solstices, USNO), rounded to the minute.
const MARCH_EQUINOX_2024 = '2024-03-20T03:06:00Z'; // Pisces → Aries
const JUNE_SOLSTICE_2024 = '2024-06-20T20:51:00Z'; // Gemini → Cancer
const SEPTEMBER_EQUINOX_2023 = '2023-09-23T06:50:00Z'; // Virgo → Libra
const DECEMBER_SOLSTICE_2024 = '2024-12-21T09:20:00Z'; // Sagittarius → Capricorn

describe('signForLongitude', () => {
  it('maps each 30° slice to a sign and normalizes out-of-range longitudes', () => {
    expect(signForLongitude(0)).toBe('aries');
    expect(signForLongitude(29.999)).toBe('aries');
    expect(signForLongitude(30)).toBe('taurus');
    expect(signForLongitude(359.999)).toBe('pisces');
    expect(signForLongitude(360)).toBe('aries');
    expect(signForLongitude(-1)).toBe('pisces');
  });

  it('rejects non-finite longitudes', () => {
    expect(() => signForLongitude(Number.NaN)).toThrow(RangeError);
  });
});

describe('sunLongitude', () => {
  it('is about 0° at the March equinox and 270° at the December solstice', () => {
    const equinox = sunLongitude(at(MARCH_EQUINOX_2024));
    expect(Math.min(equinox, 360 - equinox)).toBeLessThan(0.01);
    expect(sunLongitude(at(DECEMBER_SOLSTICE_2024))).toBeCloseTo(270, 1);
  });

  it('rejects an invalid Date', () => {
    expect(() => sunLongitude(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('sunSign with a known UTC instant', () => {
  it.each([
    [MARCH_EQUINOX_2024, 'pisces', 'aries'],
    [JUNE_SOLSTICE_2024, 'gemini', 'cancer'],
    [SEPTEMBER_EQUINOX_2023, 'virgo', 'libra'],
    [DECEMBER_SOLSTICE_2024, 'sagittarius', 'capricorn'],
  ] as const)('switches sign at the ingress %s', (ingress, before, after) => {
    const date = ingress.slice(0, 10);
    expect(sunSign(date, at(ingress, -10))).toMatchObject({
      sign: before,
      method: 'longitude',
      cusp: false,
    });
    expect(sunSign(date, at(ingress, 10))).toMatchObject({
      sign: after,
      method: 'longitude',
      cusp: false,
    });
  });

  it('returns the longitude it used', () => {
    const result = sunSign('1990-08-15', at('1990-08-15T18:00:00Z'));
    expect(result.method).toBe('longitude');
    if (result.method === 'longitude') {
      expect(result.sign).toBe('leo');
      expect(result.longitude).toBeGreaterThanOrEqual(120);
      expect(result.longitude).toBeLessThan(150);
    }
  });
});

describe('sunSign with the date only', () => {
  it.each([
    ['2024-01-05', 'capricorn'],
    ['2024-02-05', 'aquarius'],
    ['2024-03-05', 'pisces'],
    ['2024-04-05', 'aries'],
    ['2024-05-05', 'taurus'],
    ['2024-06-05', 'gemini'],
    ['2024-07-05', 'cancer'],
    ['2024-08-05', 'leo'],
    ['2024-09-05', 'virgo'],
    ['2024-10-05', 'libra'],
    ['2024-11-05', 'scorpio'],
    ['2024-12-05', 'sagittarius'],
  ] as const)('%s is %s with no cusp', (date, sign) => {
    expect(sunSign(date)).toEqual({ sign, method: 'date', cusp: false });
  });

  it('keeps Capricorn across the year boundary', () => {
    expect(sunSign('2023-12-31')).toEqual({ sign: 'capricorn', method: 'date', cusp: false });
    expect(sunSign('2024-01-01')).toEqual({ sign: 'capricorn', method: 'date', cusp: false });
  });

  it('handles 29 February', () => {
    expect(sunSign('2024-02-29')).toEqual({ sign: 'pisces', method: 'date', cusp: false });
  });

  it('2024-03-20 is a cusp day with Aries primary (sign at 12:00 UTC) and Pisces as alternative', () => {
    // The equinox at 03:06 UTC falls between the day's extremes (19 Mar 10:00 UTC – 21 Mar 12:00 UTC).
    expect(sunSign('2024-03-20')).toEqual({
      sign: 'aries',
      method: 'date',
      cusp: true,
      alternative: 'pisces',
    });
  });

  it('uses the sign at 12:00 UTC as primary when the ingress comes later that day', () => {
    // Ingress at 20:51 UTC, so at noon UTC the Sun is still in Gemini.
    expect(sunSign('2024-06-20')).toEqual({
      sign: 'gemini',
      method: 'date',
      cusp: true,
      alternative: 'cancer',
    });
  });

  it('flags the day before an early-UTC ingress, since it ends after the ingress in UTC−12', () => {
    expect(sunSign('2024-03-19')).toEqual({
      sign: 'pisces',
      method: 'date',
      cusp: true,
      alternative: 'aries',
    });
  });

  it('does not flag days whose extremes are both clear of the ingress', () => {
    expect(sunSign('2024-03-18')).toEqual({ sign: 'pisces', method: 'date', cusp: false });
    expect(sunSign('2024-03-21')).toEqual({ sign: 'aries', method: 'date', cusp: false });
  });
});

describe('sunSign input validation', () => {
  it.each(['2023-02-29', '2024-13-01', '2024-04-31', '2024-3-20', '20-03-2024', ''])(
    'rejects "%s"',
    (date) => {
      expect(() => sunSign(date)).toThrow(RangeError);
    },
  );

  it('validates the date even when a UTC instant is given', () => {
    expect(() => sunSign('2024-02-30', at(MARCH_EQUINOX_2024))).toThrow(RangeError);
  });
});
