// Birth date + local time + IANA zone → UTC instant, using the zone's rules on that date.
//
// Luxon reads the zone rules from the runtime's Intl (ICU) data, so historical offsets
// (e.g. Costa Rica's DST in 1979–80 and 1991–92) come from the tz database, not from
// today's offset.

import { DateTime, IANAZone } from 'luxon';

import type { IsoDate, IsoTime } from '../db/types.ts';

/** Local time used when the birth time is unknown. */
const UNKNOWN_TIME = { hour: 12, minute: 0 };

export interface UtcResult {
  utc: Date;
  /** False when the birth time was unknown and 12:00 local was assumed. */
  timeKnown: boolean;
  /** UTC offset in effect at `utc`, in minutes (e.g. −300 during Costa Rica DST). */
  offsetMinutes: number;
  /**
   * `gap`: the local time never existed (clocks jumped forward) and was shifted forward by the gap.
   * `ambiguous`: the local time happened twice (clocks went back) and the earlier instant was used.
   */
  adjusted: 'none' | 'gap' | 'ambiguous';
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
    if (DateTime.utc(year, month, day).isValid) {
      return { year, month, day };
    }
  }
  throw new RangeError(`date must be a valid YYYY-MM-DD date, got "${date}"`);
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match) {
    const [hour, minute] = match.slice(1).map(Number) as [number, number];
    if (hour <= 23 && minute <= 59) {
      return { hour, minute };
    }
  }
  throw new RangeError(`time must be a valid HH:mm time, got "${time}"`);
}

/**
 * Converts a local birth date and time in `ianaTz` to UTC.
 *
 * With `time` null, 12:00 local is used and `timeKnown` is false. Local times inside a DST gap
 * are shifted forward by the gap; local times that occurred twice resolve to the earlier instant.
 */
export function toUtc(date: IsoDate, time: IsoTime | null, ianaTz: string): UtcResult {
  const ymd = parseDate(date);
  const hm = time === null ? UNKNOWN_TIME : parseTime(time);
  if (!IANAZone.isValidZone(ianaTz)) {
    throw new RangeError(`ianaTz must be a valid IANA timezone, got "${ianaTz}"`);
  }

  // Luxon shifts a nonexistent local time forward by the gap; for an ambiguous one,
  // getPossibleOffsets() returns both instants.
  const local = DateTime.fromObject({ ...ymd, ...hm }, { zone: ianaTz });
  const candidates = local.getPossibleOffsets();
  const resolved = candidates.reduce((a, b) => (b.toMillis() < a.toMillis() ? b : a), local);

  let adjusted: UtcResult['adjusted'] = 'none';
  if (candidates.length > 1) {
    adjusted = 'ambiguous';
  } else if (
    local.year !== ymd.year ||
    local.month !== ymd.month ||
    local.day !== ymd.day ||
    local.hour !== hm.hour ||
    local.minute !== hm.minute
  ) {
    adjusted = 'gap';
  }

  return {
    utc: resolved.toJSDate(),
    timeKnown: time !== null,
    offsetMinutes: resolved.offset,
    adjusted,
  };
}
