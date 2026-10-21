// A client's sun, moon and rising signs from whatever birth data is known.
//
// - No birth date: nothing.
// - Date without a timezone (no place): the sun from the date alone (`sunSign`, which may report
//   a cusp). The Moon is left out: across every timezone a date can fall in, it nearly always
//   changes sign.
// - Date and timezone, no time: the sun from the date alone; the Moon at 12:00 local, unless it
//   changes sign during that local day (`moonSignUncertain`), in which case it is left out and
//   marked uncertain.
// - Date, time and timezone: sun and Moon at that instant (historical offsets via `toUtc`); the
//   rising sign too when the coordinates are known.

import type { Client } from '../db/types.ts';
import type { SignKey } from '../seed/zodiac.ts';
import { ascendantAndHouses } from './houses.ts';
import { moonLongitude, moonSignUncertain } from './planets.ts';
import { signForLongitude, sunSign } from './sunSign.ts';
import { toUtc } from './toUtc.ts';

export interface ClientSigns {
  /** Null without a birth date. On a cusp date, `alternative` is the other possible sign. */
  sun: { sign: SignKey; alternative: SignKey | null } | null;
  /** Null when unknown (no place) or uncertain (see `moonUncertain`). */
  moon: SignKey | null;
  /** True when the time is unknown and the Moon changes sign during that local day. */
  moonUncertain: boolean;
  /** Only with birth time and place. */
  rising: SignKey | null;
}

export type BirthData = Pick<
  Client,
  'birth_date' | 'birth_time' | 'birth_lat' | 'birth_lng' | 'birth_tz'
>;

const NO_SIGNS: ClientSigns = { sun: null, moon: null, moonUncertain: false, rising: null };

export function clientSigns(birth: BirthData): ClientSigns {
  const {
    birth_date: date,
    birth_time: time,
    birth_lat: lat,
    birth_lng: lng,
    birth_tz: tz,
  } = birth;
  if (date === null) return NO_SIGNS;

  if (tz === null) {
    return { ...NO_SIGNS, sun: sunFrom(date) };
  }

  if (time === null) {
    // Decision (T2.8 decision 2): an uncertain Moon is left out rather than counting both
    // possible signs.
    if (moonSignUncertain(date, tz)) {
      return { ...NO_SIGNS, sun: sunFrom(date), moonUncertain: true };
    }
    const noon = toUtc(date, null, tz).utc;
    return { ...NO_SIGNS, sun: sunFrom(date), moon: signForLongitude(moonLongitude(noon)) };
  }

  const { utc } = toUtc(date, time, tz);
  return {
    sun: sunFrom(date, utc),
    moon: signForLongitude(moonLongitude(utc)),
    moonUncertain: false,
    rising: lat !== null && lng !== null ? ascendantAndHouses(utc, lat, lng).ascendant.sign : null,
  };
}

function sunFrom(date: string, utc?: Date): NonNullable<ClientSigns['sun']> {
  const sun = sunSign(date, utc);
  return { sign: sun.sign, alternative: sun.cusp ? sun.alternative : null };
}
