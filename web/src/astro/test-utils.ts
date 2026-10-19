import type { PlanetPosition } from './planets.ts';

/**
 * The last millisecond before `position` changes sign between `from` and `to`, found by
 * bisection. `position(from)` and `position(to)` must be in different signs, with one sign change
 * in between. At the returned instant the longitude is a hair under a multiple of 30°.
 */
export function lastInstantBeforeIngress(
  position: (utc: Date) => PlanetPosition,
  from: Date,
  to: Date,
): Date {
  const startSign = position(from).sign;
  if (position(to).sign === startSign) {
    throw new Error('position must change sign between from and to');
  }
  let lo = from.getTime();
  let hi = to.getTime();
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (position(new Date(mid)).sign === startSign) lo = mid;
    else hi = mid;
  }
  return new Date(lo);
}
