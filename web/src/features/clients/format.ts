import type { Currency, IsoDate, IsoDateTime } from '../../db';

const LOCALE = 'es-CR';
const SYMBOL: Record<Currency, string> = { CRC: '₡', USD: 'US$' };

// Minimal formatter for the delete summary. T1.8b adds the shared money helpers;
// switch to those once both are on main.
/** `4500000, 'CRC'` → `₡45 000`; decimals only when there are céntimos/cents. */
export function formatMoney(amountMinor: number, currency: Currency): string {
  const number = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `${SYMBOL[currency]}${number}`;
}

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
