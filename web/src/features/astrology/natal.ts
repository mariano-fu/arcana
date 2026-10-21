// What the client's astrology panel shows, from whatever birth data is known (spec Feature 4).
//
// Sun, Moon and rising come from `clientSigns` (T2.8), so the panel and the crystal recommender
// always agree, including on cusps and an uncertain Moon. Degrees come from the same
// calculations (`planetPositions`, `ascendantAndHouses`) at the same instant.

import {
  ascendantAndHouses,
  clientSigns,
  moonSignsOnLocalDay,
  PLANET_KEYS,
  planetPositions,
  toUtc,
  type BirthData,
  type ClientSigns,
  type HousesResult,
  type PlanetKey,
} from '../../astro';
import type { Client } from '../../db';
import type { SignKey } from '../../seed/zodiac';

/**
 * - `noDate`: nothing to show but a request for the date.
 * - `noPlace`: the sun profile only (no timezone, so no Moon or planets).
 * - `noTime`: sun profile and planets by sign; no ascendant or houses.
 * - `full`: everything, with degrees.
 */
export type NatalCase = 'noDate' | 'noPlace' | 'noTime' | 'full';

export interface NatalPlanet {
  planet: PlanetKey;
  sign: SignKey;
  /** Null without a birth time: noon positions are only good for the sign (Provisional T2.6 A3). */
  longitude: number | null;
}

export interface NatalView {
  case: NatalCase;
  signs: ClientSigns;
  /** A place name was typed but never got coordinates (older clients, or text without a pick). */
  placeWithoutCoordinates: boolean;
  /**
   * The Moon's sign at the start and end of the birth day, when it changed sign that day and
   * the time is unknown (Provisional T2.6 A2: shown as "X o Y" with a warning).
   */
  moonOptions: { start: SignKey; end: SignKey } | null;
  /** Sun to Pluto; null in `noDate` and `noPlace`. Sun and Moon rows follow `signs`. */
  planets: NatalPlanet[] | null;
  /** Ascendant, MC and cusps; only with time, timezone and coordinates. */
  houses: HousesResult | null;
  /** The birth time fell in a DST gap or overlap (`toUtc` adjusted it). */
  timeAdjusted: boolean;
}

export type NatalBirth = BirthData & Pick<Client, 'birth_place_label'>;

export function natalView(birth: NatalBirth): NatalView {
  const signs = clientSigns(birth);
  const { birth_date: date, birth_time: time, birth_lat: lat, birth_lng: lng } = birth;
  const tz = birth.birth_tz;
  const base: NatalView = {
    case: 'noDate',
    signs,
    placeWithoutCoordinates:
      (birth.birth_place_label ?? '').trim() !== '' && (tz === null || lat === null),
    moonOptions: null,
    planets: null,
    houses: null,
    timeAdjusted: false,
  };
  if (date === null) return base;
  if (tz === null) return { ...base, case: 'noPlace' };

  if (time === null) {
    const noon = planetPositions(toUtc(date, null, tz).utc);
    const moonOptions = signs.moonUncertain ? moonSignsOnLocalDay(date, tz) : null;
    return {
      ...base,
      case: 'noTime',
      moonOptions,
      planets: PLANET_KEYS.map((planet) => ({
        planet,
        // Sun and Moon follow clientSigns (cusp and uncertain-Moon rules); an uncertain Moon's
        // row shows `moonOptions` instead of this sign.
        sign:
          planet === 'sun' && signs.sun
            ? signs.sun.sign
            : planet === 'moon' && signs.moon
              ? signs.moon
              : noon[planet].sign,
        longitude: null,
      })),
    };
  }

  const utc = toUtc(date, time, tz);
  const positions = planetPositions(utc.utc);
  return {
    ...base,
    case: 'full',
    planets: PLANET_KEYS.map((planet) => ({
      planet,
      sign: positions[planet].sign,
      longitude: positions[planet].longitude,
    })),
    houses: lat !== null && lng !== null ? ascendantAndHouses(utc.utc, lat, lng) : null,
    timeAdjusted: utc.adjusted !== 'none',
  };
}
