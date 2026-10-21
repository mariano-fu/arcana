import { clientSigns, formatPosition, moonLongitude, signForLongitude, toUtc } from '../../astro';
import { natalView, type NatalBirth } from './natal';

const CR = 'America/Costa_Rica';
const SAN_JOSE = { birth_lat: 9.9333, birth_lng: -84.0833, birth_tz: CR };

function birth(overrides: Partial<NatalBirth> = {}): NatalBirth {
  return {
    birth_date: null,
    birth_time: null,
    birth_lat: null,
    birth_lng: null,
    birth_tz: null,
    birth_place_label: null,
    ...overrides,
  };
}

describe('natalView', () => {
  it('has nothing without a birth date', () => {
    expect(natalView(birth())).toMatchObject({ case: 'noDate', planets: null, houses: null });
  });

  it('shows only the sun without a place, even with a time', () => {
    for (const time of [null, '10:00']) {
      const view = natalView(birth({ birth_date: '1990-08-10', birth_time: time }));
      expect(view.case).toBe('noPlace');
      expect(view.signs.sun).toEqual({ sign: 'leo', alternative: null });
      expect(view.planets).toBeNull();
      expect(view.placeWithoutCoordinates).toBe(false);
    }
  });

  it('flags a place name that has no coordinates', () => {
    const view = natalView(birth({ birth_date: '1990-08-10', birth_place_label: 'Finca en Dota' }));
    expect(view).toMatchObject({ case: 'noPlace', placeWithoutCoordinates: true });
  });

  it('keeps the sun cusp from clientSigns', () => {
    const view = natalView(birth({ birth_date: '2024-03-19' }));
    expect(view.signs.sun).toEqual({ sign: 'pisces', alternative: 'aries' });
  });

  it('lists planets by sign only when the time is unknown', () => {
    const data = birth({ birth_date: '1990-08-10', ...SAN_JOSE });
    const view = natalView(data);
    expect(view.case).toBe('noTime');
    expect(view.houses).toBeNull();
    expect(view.planets).toHaveLength(10);
    expect(view.planets?.every((p) => p.longitude === null)).toBe(true);
    const signs = clientSigns(data);
    expect(view.planets?.[0]).toEqual({ planet: 'sun', sign: signs.sun?.sign, longitude: null });
    expect(view.planets?.[1]).toEqual({ planet: 'moon', sign: signs.moon, longitude: null });
  });

  it('gives both possible Moon signs when it changes sign that day', () => {
    const view = natalView(birth({ birth_date: '2021-03-29', ...SAN_JOSE }));
    expect(view.signs.moonUncertain).toBe(true);
    const start = signForLongitude(moonLongitude(toUtc('2021-03-29', '00:00', CR).utc));
    expect(view.moonOptions?.start).toBe(start);
    expect(view.moonOptions?.end).not.toBe(start);
  });

  it('gives degrees, ascendant, MC and houses with time and place (CR 1991, astro-seek)', () => {
    const data = birth({ birth_date: '1991-02-03', birth_time: '21:40', ...SAN_JOSE });
    const view = natalView(data);
    expect(view.case).toBe('full');
    expect(view.timeAdjusted).toBe(false);
    expect(view.houses?.system).toBe('placidus');
    expect(formatPosition(view.houses?.ascendant.longitude ?? NaN)).toBe('29°40′ Virgo');
    expect(formatPosition(view.houses?.mc.longitude ?? NaN)).toBe('29°42′ Géminis');
    expect(view.houses?.cusps).toHaveLength(12);

    // Same signs as the crystal recommender sees.
    const signs = clientSigns(data);
    expect(view.planets?.[0]?.sign).toBe(signs.sun?.sign);
    expect(view.planets?.[1]?.sign).toBe(signs.moon);
    expect(view.houses?.ascendant.sign).toBe(signs.rising);
  });

  it('flags a birth time inside a DST change', () => {
    // 1979-02-25 00:00 CST jumped to 01:00 CDT in Costa Rica, so 00:30 never existed.
    const gap = natalView(birth({ birth_date: '1979-02-25', birth_time: '00:30', ...SAN_JOSE }));
    expect(gap.timeAdjusted).toBe(true);
    const normal = natalView(birth({ birth_date: '1979-02-25', birth_time: '01:00', ...SAN_JOSE }));
    expect(normal.timeAdjusted).toBe(false);
  });

  it('falls back to whole-sign houses beyond the polar circle', () => {
    const view = natalView(
      birth({
        birth_date: '1990-06-21',
        birth_time: '12:00',
        birth_lat: 69.6492,
        birth_lng: 18.9553,
        birth_tz: 'Europe/Oslo',
      }),
    );
    expect(view.houses?.system).toBe('whole-sign');
  });
});
