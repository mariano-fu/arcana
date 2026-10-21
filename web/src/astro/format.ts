// One way to write a zodiac position everywhere: degrees and arc-minutes within the sign,
// always floored, so 29.9999° reads 29°59′ and never 29°60′ or 30°00′ (that would name a
// degree of the next sign while the sign shown is still this one).

import { SIGN_KEYS, zodiacSeed, type SignKey } from '../seed/zodiac.ts';
import { signForLongitude } from './sunSign.ts';

const LAST_MINUTE_IN_SIGN = 30 * 60 - 1;

export interface SplitPosition {
  sign: SignKey;
  /** 0–29. */
  degrees: number;
  /** 0–59. */
  minutes: number;
}

/** Ecliptic longitude (any real number of degrees) → sign, whole degrees and arc-minutes. */
export function splitPosition(longitude: number): SplitPosition {
  if (!Number.isFinite(longitude)) {
    throw new RangeError(`longitude must be finite, got ${String(longitude)}`);
  }
  const normalized = ((longitude % 360) + 360) % 360;
  const sign = signForLongitude(normalized);
  const inSign = normalized - SIGN_KEYS.indexOf(sign) * 30;
  // Floor the total arc-minutes; the cap keeps a float a hair under 30° in this sign.
  const total = Math.min(Math.max(Math.floor(inSign * 60), 0), LAST_MINUTE_IN_SIGN);
  return { sign, degrees: Math.floor(total / 60), minutes: total % 60 };
}

/** `29°40′` (degrees and minutes only). */
export function formatDegrees({ degrees, minutes }: SplitPosition): string {
  return `${String(degrees)}°${String(minutes).padStart(2, '0')}′`;
}

/** The sign's Spanish name from the zodiac seed, e.g. `Géminis`. */
export function signName(sign: SignKey): string {
  return zodiacSeed.signs.find((s) => s.key === sign)?.name ?? sign;
}

/** `29°40′ Virgo`. */
export function formatPosition(longitude: number): string {
  const split = splitPosition(longitude);
  return `${formatDegrees(split)} ${signName(split.sign)}`;
}
