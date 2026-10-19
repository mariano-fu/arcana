// Sun sign (Western tropical zodiac), always from the Sun's computed ecliptic longitude.
//
// The seed's `start`/`end` table is only for displaying date ranges: ingress days move by
// a day or so between years, so the table is never used to decide the sign.

import { SunPosition } from 'astronomy-engine';

import { SIGN_KEYS, type SignKey } from '../seed/zodiac.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Earliest and latest UTC offsets in use (UTC+14 starts a calendar day first, UTC−12 ends it last). */
const MAX_OFFSET_EAST_MS = 14 * HOUR_MS;
const MAX_OFFSET_WEST_MS = 12 * HOUR_MS;

export type SunSignResult =
  /** Exact: computed for the given UTC instant. */
  | { sign: SignKey; method: 'longitude'; longitude: number; cusp: false }
  /** Date only: the sign was the same at both extremes of that calendar day anywhere on Earth. */
  | { sign: SignKey; method: 'date'; cusp: false }
  /**
   * Date only: the Sun changed sign at some point during that calendar day somewhere on Earth.
   * `sign` is the sign at 12:00 UTC that day; `alternative` is the other one.
   */
  | { sign: SignKey; method: 'date'; cusp: true; alternative: SignKey };

/** The Sun's apparent geocentric ecliptic longitude (true equinox of date), in [0, 360). */
export function sunLongitude(utc: Date): number {
  if (Number.isNaN(utc.getTime())) {
    throw new RangeError('utc must be a valid Date');
  }
  const { elon } = SunPosition(utc);
  return ((elon % 360) + 360) % 360;
}

/** Tropical sign for an ecliptic longitude in degrees (0° = 0° Aries). */
export function signForLongitude(longitude: number): SignKey {
  if (!Number.isFinite(longitude)) {
    throw new RangeError(`longitude must be finite, got ${String(longitude)}`);
  }
  const normalized = ((longitude % 360) + 360) % 360;
  return SIGN_KEYS[Math.floor(normalized / 30)] as SignKey;
}

/** Parses a strict `YYYY-MM-DD` calendar date to 00:00 UTC of that day, in epoch ms. */
function parseDate(birthDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
    const ms = Date.UTC(year, month - 1, day);
    const parsed = new Date(ms);
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return ms;
    }
  }
  throw new RangeError(`birthDate must be a valid YYYY-MM-DD date, got "${birthDate}"`);
}

/**
 * Sun sign for a client.
 *
 * With `utc` (birth time and place known, converted by `toUtc`), the sign comes from the Sun's
 * longitude at that instant and `birthDate` is only validated.
 *
 * With the date only, the Sun's longitude is computed at the two extreme instants of that
 * calendar day (its start in UTC+14 and its end in UTC−12). If both fall in the same sign there
 * is no doubt; otherwise it is a cusp day and both candidates are returned.
 */
export function sunSign(birthDate: string, utc?: Date): SunSignResult {
  const dayStartUtc = parseDate(birthDate);

  if (utc !== undefined) {
    const longitude = sunLongitude(utc);
    return { sign: signForLongitude(longitude), method: 'longitude', longitude, cusp: false };
  }

  const earliest = signForLongitude(sunLongitude(new Date(dayStartUtc - MAX_OFFSET_EAST_MS)));
  // Last millisecond of the day in UTC−12.
  const latest = signForLongitude(
    sunLongitude(new Date(dayStartUtc + DAY_MS + MAX_OFFSET_WEST_MS - 1)),
  );
  if (earliest === latest) {
    return { sign: earliest, method: 'date', cusp: false };
  }

  const sign = signForLongitude(sunLongitude(new Date(dayStartUtc + 12 * HOUR_MS)));
  return {
    sign,
    method: 'date',
    cusp: true,
    alternative: sign === earliest ? latest : earliest,
  };
}
