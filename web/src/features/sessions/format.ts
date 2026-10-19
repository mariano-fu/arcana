import type { IsoDateTime } from '../../db';

/** A UTC timestamp as date and time in the device's timezone, e.g. `10 oct 2026, 9:00`. */
export function formatDateTime(timestamp: IsoDateTime): string {
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  );
}
