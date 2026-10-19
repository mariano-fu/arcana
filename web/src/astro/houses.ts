// Ascendant, Midheaven and house cusps (Western tropical zodiac).
//
// Placidus is the default. It divides each point's diurnal and nocturnal semi-arcs into thirds,
// which is undefined where parts of the ecliptic never rise or never set: at or beyond the polar
// circles (|latitude| ≥ 90° − obliquity, about 66.56°). There the houses fall back to whole-sign.

import { e_tilt, MakeTime, SiderealTime } from 'astronomy-engine';

import type { PlanetPosition } from './planets.ts';
import { signForLongitude } from './sunSign.ts';

export type HouseSystem = 'placidus' | 'whole-sign';

export interface HousesResult {
  /** `whole-sign` when Placidus is undefined at this latitude. */
  system: HouseSystem;
  ascendant: PlanetPosition;
  /** Midheaven. Under whole-sign it is still the MC point, not the 10th cusp. */
  mc: PlanetPosition;
  /** Cusps of houses 1–12, in order (`cusps[0]` is the 1st house). */
  cusps: PlanetPosition[];
}

const DEG = Math.PI / 180;
const MAX_ITERATIONS = 100;
const CONVERGENCE_DEG = 1e-9;

const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;
const sin = (degrees: number) => Math.sin(degrees * DEG);
const cos = (degrees: number) => Math.cos(degrees * DEG);
const tan = (degrees: number) => Math.tan(degrees * DEG);
const atan2 = (y: number, x: number) => Math.atan2(y, x) / DEG;

function positionFor(longitude: number): PlanetPosition {
  return { longitude, sign: signForLongitude(longitude), degree: longitude % 30 };
}

/** Longitude of the ecliptic point with right ascension `ra` (both in degrees). */
const eclipticFromRa = (ra: number, obliquity: number) =>
  normalize(atan2(sin(ra), cos(ra) * cos(obliquity)));

/**
 * Placidus cusp: the ecliptic point whose right ascension is `ramcOffset` plus `fraction` of its
 * own diurnal semi-arc (or minus `fraction` of its nocturnal one, when `nocturnal`). The semi-arc
 * depends on the point's declination, hence the fixed-point iteration. Null if it fails.
 */
function placidusCusp(
  ramc: number,
  latitude: number,
  obliquity: number,
  fraction: number,
  nocturnal: boolean,
): number | null {
  const base = nocturnal ? ramc + 180 : ramc;
  let ra = base + (nocturnal ? -fraction : fraction) * 90;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const declination = Math.asin(sin(obliquity) * sin(eclipticFromRa(ra, obliquity))) / DEG;
    const x = -tan(latitude) * tan(declination);
    if (Math.abs(x) > 1) return null;
    const diurnal = Math.acos(x) / DEG;
    const next = nocturnal ? base - fraction * (180 - diurnal) : base + fraction * diurnal;
    if (Math.abs(next - ra) < CONVERGENCE_DEG) return eclipticFromRa(next, obliquity);
    ra = next;
  }
  return null;
}

function placidusCusps(
  ascendant: number,
  mc: number,
  ramc: number,
  latitude: number,
  obliquity: number,
): number[] | null {
  const c11 = placidusCusp(ramc, latitude, obliquity, 1 / 3, false);
  const c12 = placidusCusp(ramc, latitude, obliquity, 2 / 3, false);
  const c2 = placidusCusp(ramc, latitude, obliquity, 2 / 3, true);
  const c3 = placidusCusp(ramc, latitude, obliquity, 1 / 3, true);
  if (c11 === null || c12 === null || c2 === null || c3 === null) return null;
  const eastern = [
    ascendant,
    c2,
    c3,
    normalize(mc + 180),
    normalize(c11 + 180),
    normalize(c12 + 180),
  ];
  const western = [
    normalize(ascendant + 180),
    normalize(c2 + 180),
    normalize(c3 + 180),
    mc,
    c11,
    c12,
  ];
  return [...eastern, ...western];
}

/** Whole-sign houses: the 1st house is the ascendant's whole sign, then one sign per house. */
function wholeSignCusps(ascendant: number): number[] {
  const first = Math.floor(ascendant / 30) * 30;
  return Array.from({ length: 12 }, (_, i) => normalize(first + i * 30));
}

/**
 * Ascendant, Midheaven and house cusps for a known birth instant and place.
 *
 * `lat` is north-positive and `lng` east-positive, in degrees. Uses apparent sidereal time and
 * the true obliquity of date, so the angles share the frame of `planetPositions`.
 */
export function ascendantAndHouses(utc: Date, lat: number, lng: number): HousesResult {
  if (Number.isNaN(utc.getTime())) {
    throw new RangeError('utc must be a valid Date');
  }
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new RangeError(`lat must be between -90 and 90, got ${String(lat)}`);
  }
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new RangeError(`lng must be between -180 and 180, got ${String(lng)}`);
  }

  const time = MakeTime(utc);
  const obliquity = e_tilt(time).tobl;
  const ramc = normalize(SiderealTime(time) * 15 + lng);

  const mc = eclipticFromRa(ramc, obliquity);
  let ascendant = normalize(
    atan2(cos(ramc), -(sin(ramc) * cos(obliquity) + tan(lat) * sin(obliquity))),
  );
  // Beyond the polar circles the formula can return the descendant; the ascendant is always the
  // eastern intersection, within 180° after the MC.
  if (normalize(ascendant - mc) > 180) {
    ascendant = normalize(ascendant + 180);
  }

  const placidus =
    Math.abs(lat) < 90 - obliquity ? placidusCusps(ascendant, mc, ramc, lat, obliquity) : null;

  return {
    system: placidus ? 'placidus' : 'whole-sign',
    ascendant: positionFor(ascendant),
    mc: positionFor(mc),
    cusps: (placidus ?? wholeSignCusps(ascendant)).map(positionFor),
  };
}
