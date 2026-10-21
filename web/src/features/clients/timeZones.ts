import type { TFunction } from 'i18next';
import { IANAZone } from 'luxon';

import { foldText } from '../spreads/cardSearch';

/**
 * Zones she is most likely to need, listed first in this order, with hand-written Spanish
 * names (`clients.form.tz.common.<key>` in es.json): Costa Rica, Central America, the US
 * and Spain.
 */
export const COMMON_TIME_ZONES = [
  ['America/Costa_Rica', 'costaRica'],
  ['America/Guatemala', 'guatemala'],
  ['America/El_Salvador', 'elSalvador'],
  ['America/Tegucigalpa', 'honduras'],
  ['America/Managua', 'nicaragua'],
  ['America/Panama', 'panama'],
  ['America/New_York', 'usEast'],
  ['America/Chicago', 'usCentral'],
  ['America/Denver', 'usMountain'],
  ['America/Phoenix', 'usArizona'],
  ['America/Los_Angeles', 'usPacific'],
  ['America/Anchorage', 'usAlaska'],
  ['Pacific/Honolulu', 'usHawaii'],
  ['Europe/Madrid', 'spainMainland'],
  ['Atlantic/Canary', 'spainCanary'],
] as const;

type CommonKey = (typeof COMMON_TIME_ZONES)[number][1];
const commonKeys = new Map<string, CommonKey>(COMMON_TIME_ZONES);

/** Most suggestions shown at once; typing more narrows the list. */
export const MAX_TIME_ZONE_RESULTS = 30;

export interface TimeZoneOption {
  /** IANA name, what `birth_tz` stores. */
  id: string;
  /** Spanish label with today's offset. */
  label: string;
  common: boolean;
  /** Folded label and IANA name, for search. */
  search: string;
}

/** `UTC−6`, `UTC+5:30`, `UTC` (a real minus sign, like the labels she reads elsewhere). */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${String(hours)}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`;
}

/** The zone's Spanish generic name, e.g. "hora de Europa central"; null for bare GMT offsets. */
function genericName(id: string): string | null {
  const part = new Intl.DateTimeFormat('es', { timeZone: id, timeZoneName: 'longGeneric' })
    .formatToParts(new Date(0))
    .find((p) => p.type === 'timeZoneName')?.value;
  return part === undefined || /^(GMT|UTC)/.test(part) ? null : part;
}

/** `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
function cityName(id: string): string {
  return (id.split('/').pop() ?? id).replace(/_/g, ' ');
}

/**
 * The label for a zone, with its offset **today** ("hoy UTC−6"): a birth may predate a DST
 * change (Costa Rica used DST in 1991–92), so this is not the offset at the birth.
 */
export function timeZoneLabel(id: string, t: TFunction, now: Date = new Date()): string {
  const key = commonKeys.get(id);
  let name: string;
  if (key !== undefined) {
    name = t(`clients.form.tz.common.${key}`);
  } else if (IANAZone.isValidZone(id)) {
    const generic = genericName(id);
    name = generic === null ? cityName(id) : `${cityName(id)} — ${generic}`;
  } else {
    return id;
  }
  const offset = IANAZone.create(id).offset(now.getTime());
  return t('clients.form.tz.label', { name, offset: formatUtcOffset(offset) });
}

/**
 * Every zone the browser knows, common ones first (in COMMON_TIME_ZONES order), the rest by
 * label. `extra` is a saved zone the browser doesn't list, kept so it still shows.
 */
export function timeZoneOptions(
  t: TFunction,
  extra: string | null = null,
  now: Date = new Date(),
): TimeZoneOption[] {
  const known = new Set(Intl.supportedValuesOf('timeZone'));
  const ids = [...COMMON_TIME_ZONES.map(([id]) => id), ...known].filter(
    (id, i, all) => all.indexOf(id) === i,
  );
  if (extra !== null && extra !== '' && !ids.includes(extra)) ids.push(extra);

  const options = ids.map((id) => {
    const label = timeZoneLabel(id, t, now);
    return {
      id,
      label,
      common: commonKeys.has(id),
      search: foldText(`${label} ${id.replace(/[/_]/g, ' ')}`),
    };
  });
  const rest = options
    .filter((option) => !option.common)
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return [...options.filter((option) => option.common), ...rest];
}

/**
 * Suggestions for `query`: the common zones when it's empty, otherwise every zone whose label
 * or IANA name contains all its words (ignoring case and accents), at most
 * MAX_TIME_ZONE_RESULTS.
 */
export function searchTimeZones(
  options: readonly TimeZoneOption[],
  query: string,
): TimeZoneOption[] {
  const words = foldText(query).replace(/[/_]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return options.filter((option) => option.common);
  return options
    .filter((option) => words.every((word) => option.search.includes(word)))
    .slice(0, MAX_TIME_ZONE_RESULTS);
}
