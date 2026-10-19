import { z } from 'zod';

import type { Currency, IsoDateTime, Session } from '../../db';
import { CURRENCIES, CURRENCY_SYMBOL, formatMoney, parseMoney } from '../payments';

/** The session fields she edits on the session page. */
export type SessionFields = Pick<
  Session,
  'started_at' | 'type' | 'price_minor' | 'currency' | 'notes' | 'follow_up_note' | 'follow_up_date'
>;

export const SESSION_FIELD_KEYS = [
  'started_at',
  'type',
  'price_minor',
  'currency',
  'notes',
  'follow_up_note',
  'follow_up_date',
] as const satisfies readonly (keyof SessionFields)[];

export const SESSION_TYPES = [
  'in_person',
  'online',
  'message',
] as const satisfies readonly Session['type'][];

/** What a new session starts with: now, in person, no price, colones. */
export function defaultSessionFields(startedAt: IsoDateTime): SessionFields {
  return {
    started_at: startedAt,
    type: 'in_person',
    price_minor: null,
    currency: 'CRC',
    notes: '',
    follow_up_note: '',
    follow_up_date: null,
  };
}

export function pickSessionFields(session: SessionFields): SessionFields {
  return {
    started_at: session.started_at,
    type: session.type,
    price_minor: session.price_minor,
    currency: session.currency,
    notes: session.notes,
    follow_up_note: session.follow_up_note,
    follow_up_date: session.follow_up_date,
  };
}

export function sameSessionFields(a: SessionFields, b: SessionFields): boolean {
  return SESSION_FIELD_KEYS.every((key) => a[key] === b[key]);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC timestamp → `YYYY-MM-DDTHH:mm` in the device's timezone, for `<input type="datetime-local">`. */
export function toLocalInput(timestamp: IsoDateTime): string {
  const d = new Date(timestamp);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value (device timezone) → UTC timestamp; null if empty or invalid. */
export function fromLocalInput(value: string): IsoDateTime | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  // Without an offset, a date-time string is parsed as local time.
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A stored price as she'd type it, without the symbol (the currency picker shows it). */
export function priceToInput(priceMinor: number | null, currency: Currency): string {
  if (priceMinor === null) return '';
  return formatMoney(priceMinor, currency).slice(CURRENCY_SYMBOL[currency].length);
}

/** Price field → minor units. Empty means no price; `undefined` means she typed something invalid. */
export function parsePriceInput(input: string): number | null | undefined {
  if (input.trim() === '') return null;
  return parseMoney(input) ?? undefined;
}

const createdFieldsSchema = z.object({
  started_at: z.string(),
  type: z.enum(SESSION_TYPES),
  price_minor: z.number().nullable(),
  currency: z.enum(CURRENCIES),
  notes: z.string(),
  follow_up_note: z.string(),
  follow_up_date: z.string().nullable(),
});

/** Router state set by "Nueva sesión": the session as created, for the discard-on-leave check. */
const sessionRouteStateSchema = z.object({
  created: createdFieldsSchema,
  unarchived: z.boolean(),
});

export type SessionRouteState = z.infer<typeof sessionRouteStateSchema>;

/** Null when the page wasn't opened right after creating the session (e.g. from the timeline). */
export function parseSessionRouteState(state: unknown): SessionRouteState | null {
  const result = sessionRouteStateSchema.safeParse(state);
  return result.success ? result.data : null;
}
