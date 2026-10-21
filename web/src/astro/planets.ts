// Planet positions (Western tropical zodiac) and moon-sign uncertainty for date-only births.
//
// All longitudes are geocentric, apparent (light-time and aberration corrected) and measured on
// the true ecliptic of date, which is the frame the tropical zodiac uses.

import { Body, Ecliptic, EclipticGeoMoon, GeoVector } from 'astronomy-engine';
import { DateTime } from 'luxon';

import type { IsoDate } from '../db/types.ts';
import type { SignKey } from '../seed/zodiac.ts';
import { signForLongitude, sunLongitude } from './sunSign.ts';
import { toUtc } from './toUtc.ts';

/** Same keys as `astro.planet.*` in es.json. */
export const PLANET_KEYS = [
  'sun',
  'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
] as const;

export type PlanetKey = (typeof PLANET_KEYS)[number];

export interface PlanetPosition {
  /** Ecliptic longitude in degrees, in [0, 360). */
  longitude: number;
  sign: SignKey;
  /** Degrees into `sign`, in [0, 30). */
  degree: number;
}

const PLANET_BODIES: Record<Exclude<PlanetKey, 'sun' | 'moon'>, Body> = {
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
  pluto: Body.Pluto,
};

const normalize = (longitude: number) => ((longitude % 360) + 360) % 360;

function assertValidDate(utc: Date): void {
  if (Number.isNaN(utc.getTime())) {
    throw new RangeError('utc must be a valid Date');
  }
}

/** The Moon's apparent geocentric ecliptic longitude (true equinox of date), in [0, 360). */
export function moonLongitude(utc: Date): number {
  assertValidDate(utc);
  return normalize(EclipticGeoMoon(utc).lon);
}

function longitudeOf(planet: PlanetKey, utc: Date): number {
  if (planet === 'sun') return sunLongitude(utc);
  if (planet === 'moon') return moonLongitude(utc);
  return normalize(Ecliptic(GeoVector(PLANET_BODIES[planet], utc, true)).elon);
}

function positionFor(longitude: number): PlanetPosition {
  return { longitude, sign: signForLongitude(longitude), degree: longitude % 30 };
}

/** Sun, Moon and planets (Mercury … Pluto) by sign at a UTC instant. */
export function planetPositions(utc: Date): Record<PlanetKey, PlanetPosition> {
  assertValidDate(utc);
  return Object.fromEntries(
    PLANET_KEYS.map((planet) => [planet, positionFor(longitudeOf(planet, utc))]),
  ) as Record<PlanetKey, PlanetPosition>;
}

/**
 * The Moon's sign at the start and at the end of the local calendar day `date` in `tz`.
 *
 * The day runs from its first local instant (00:00, or the end of a DST gap at midnight, as
 * resolved by `toUtc`) to the first instant of the next day. The Moon moves well under 30° a
 * day, so it changes sign at most once and the two ends tell the whole story.
 */
export function moonSignsOnLocalDay(date: IsoDate, tz: string): { start: SignKey; end: SignKey } {
  const start = toUtc(date, '00:00', tz).utc;
  const nextDate = DateTime.fromISO(date, { zone: 'utc' }).plus({ days: 1 }).toISODate();
  if (nextDate === null) {
    throw new RangeError(`date must be a valid YYYY-MM-DD date, got "${date}"`);
  }
  const end = new Date(toUtc(nextDate, '00:00', tz).utc.getTime() - 1);
  return {
    start: signForLongitude(moonLongitude(start)),
    end: signForLongitude(moonLongitude(end)),
  };
}

/** True if the Moon changes sign at some point during the local calendar day `date` in `tz`. */
export function moonSignUncertain(date: IsoDate, tz: string): boolean {
  const { start, end } = moonSignsOnLocalDay(date, tz);
  return start !== end;
}
