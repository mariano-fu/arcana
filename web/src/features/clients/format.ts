import type { IsoDate, IsoDateTime } from '../../db';

const LOCALE = 'es-CR';

/** `1990-04-12` → `12 de abril de 1990`. A calendar date, so no timezone shift. */
export function formatDate(date: IsoDate): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** A UTC timestamp shown as a date in the device's timezone. */
export function formatDay(timestamp: IsoDateTime): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(new Date(timestamp));
}

/** `['4 sesiones', '3 pagos']` → `4 sesiones y 3 pagos`. */
export function formatList(items: string[]): string {
  return new Intl.ListFormat('es', { type: 'conjunction' }).format(items);
}
