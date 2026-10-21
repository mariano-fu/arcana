import {
  ascendantAndHouses,
  clientSigns,
  moonLongitude,
  planetPositions,
  signForLongitude,
  sunSign,
  type BirthData,
} from '.';
import reference from './fixtures/houses-reference.json';
import { lastInstantBeforeIngress } from './test-utils.ts';

const CR = 'America/Costa_Rica';
const SAN_JOSE = { birth_lat: 9.9333, birth_lng: -84.0833 };

const birth = (fields: Partial<BirthData>): BirthData => ({
  birth_date: null,
  birth_time: null,
  birth_lat: null,
  birth_lng: null,
  birth_tz: null,
  ...fields,
});

/** UTC instant at which the Moon enters its next sign, to the millisecond, between `from` and `to`. */
const moonIngress = (from: string, to: string) =>
  new Date(
    lastInstantBeforeIngress(
      (utc) => planetPositions(utc).moon,
      new Date(from),
      new Date(to),
    ).getTime() + 1,
  );

/** Local wall-clock time of `utc` in Costa Rica, `YYYY-MM-DD HH:mm`. */
const costaRicaTime = (utc: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: CR,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(utc);

describe('clientSigns', () => {
  it('has no signs without a birth date', () => {
    expect(clientSigns(birth({ birth_time: '10:00', birth_tz: CR, ...SAN_JOSE }))).toEqual({
      sun: null,
      moon: null,
      moonUncertain: false,
      rising: null,
    });
  });

  it('gives only the sun from the date when the place is unknown, even with a time', () => {
    const expected = {
      sun: { sign: 'leo', alternative: null },
      moon: null,
      moonUncertain: false,
      rising: null,
    };
    expect(clientSigns(birth({ birth_date: '2024-08-05' }))).toEqual(expected);
    expect(clientSigns(birth({ birth_date: '2024-08-05', birth_time: '10:00' }))).toEqual(expected);
  });

  it.each([
    // The equinox is at 2024-03-20 03:06 UTC. 19 March is the first cusp day (it ends after the
    // ingress in UTC−12), 20 March the last; the days around them are clear.
    ['2024-03-18', { sign: 'pisces', alternative: null }],
    ['2024-03-19', { sign: 'pisces', alternative: 'aries' }],
    ['2024-03-20', { sign: 'aries', alternative: 'pisces' }],
    ['2024-03-21', { sign: 'aries', alternative: null }],
  ] as const)('agrees with sunSign at the cusp-detection boundary: %s', (date, sun) => {
    const astro = sunSign(date);
    expect({ sign: astro.sign, alternative: astro.cusp ? astro.alternative : null }).toEqual(sun);
    expect(clientSigns(birth({ birth_date: date })).sun).toEqual(sun);
    expect(clientSigns(birth({ birth_date: date, birth_tz: CR, ...SAN_JOSE })).sun).toEqual(sun);
  });

  describe('Moon without a birth time, in the birth timezone', () => {
    it('is uncertain when the Moon changes sign at 23:33 local that day', () => {
      const ingress = moonIngress('2021-03-30T05:00:00Z', '2021-03-30T06:00:00Z');
      expect(costaRicaTime(ingress)).toBe('2021-03-29 23:33');

      expect(clientSigns(birth({ birth_date: '2021-03-29', birth_tz: CR, ...SAN_JOSE }))).toEqual({
        sun: { sign: 'aries', alternative: null },
        moon: null,
        moonUncertain: true,
        rising: null,
      });
    });

    it('is steady and counted when the ingress comes at 00:10 local the next day', () => {
      const ingress = moonIngress('2021-04-20T06:00:00Z', '2021-04-20T07:00:00Z');
      expect(costaRicaTime(ingress)).toBe('2021-04-20 00:10');
      const signBefore = signForLongitude(moonLongitude(new Date(ingress.getTime() - 1)));

      const signs = clientSigns(birth({ birth_date: '2021-04-19', birth_tz: CR, ...SAN_JOSE }));
      expect(signs).toMatchObject({ moon: signBefore, moonUncertain: false, rising: null });
      expect(signs.moon).not.toBeNull();
    });
  });

  describe('with birth time and place', () => {
    // Costa Rica DST (UTC−5): 21:40 local is 02:40 UTC. Swiss Ephemeris puts the ascendant at
    // 29°41′ Virgo; at the standard offset (UTC−6, 03:40 UTC) it would already be in Libra.
    const dst = reference.cases.find((c) => c.label === 'San José, Costa Rica (1991 DST)');
    if (dst === undefined) throw new Error('missing 1991 DST reference case');
    const client = birth({
      birth_date: dst.date,
      birth_time: dst.time,
      birth_tz: dst.tz,
      birth_lat: dst.lat,
      birth_lng: dst.lng,
    });

    it('uses the historical offset for the ascendant', () => {
      expect(signForLongitude(dst.ascendant)).toBe('virgo');
      expect(clientSigns(client).rising).toBe('virgo');
      expect(
        ascendantAndHouses(new Date('1991-02-04T03:40:00Z'), dst.lat, dst.lng).ascendant.sign,
      ).toBe('libra');
    });

    it('takes sun and Moon at the birth instant, without cusp or uncertainty', () => {
      const utc = new Date(dst.utc);
      expect(clientSigns(client)).toEqual({
        sun: { sign: 'aquarius', alternative: null },
        moon: signForLongitude(moonLongitude(utc)),
        moonUncertain: false,
        rising: 'virgo',
      });
    });

    it('has no rising sign without coordinates', () => {
      expect(clientSigns({ ...client, birth_lat: null, birth_lng: null }).rising).toBeNull();
    });
  });
});
