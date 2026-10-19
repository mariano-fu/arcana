// The "Pagos" screen's data: a month's payments and income, and sessions still owed.
// Pure functions; the screen loads the rows (hooks.ts) and renders them (PaymentsPage.tsx).

import type { Currency, Payment, PaymentMethod, Session } from '../../db';
import { sumByCurrency, type CurrencyTotals } from './money';
import { paymentStatus, type PaymentStatusPayment } from './status';

/** A calendar month, `YYYY-MM`. `payment.paid_at` dates in it start with it. */
export type Month = string;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The device's current month. */
export function currentMonth(now: Date = new Date()): Month {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}`;
}

/** True for a real month in `YYYY-MM` form. */
export function isMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** The month `delta` months away, e.g. `shiftMonth('2026-01', -1)` → `2025-12`. */
export function shiftMonth(month: Month, delta: number): Month {
  const [year = 0, m = 1] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12))}-${pad((index % 12) + 1)}`;
}

/**
 * First and last possible `paid_at` of the month, for an inclusive index range. `-31` works for
 * every month: dates compare as strings and no real date falls between the month's end and it.
 */
export function monthRange(month: Month): [first: string, last: string] {
  return [`${month}-01`, `${month}-31`];
}

/** `2026-10` → `octubre de 2026`. */
export function formatMonth(month: Month): string {
  return new Intl.DateTimeFormat('es-CR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** The month's income: every live payment, per currency (never summed together). */
export function monthIncome(payments: Iterable<PaymentStatusPayment>): CurrencyTotals {
  return sumByCurrency([...payments].filter((p) => p.deleted_at === null));
}

export interface PaymentFilters {
  method: PaymentMethod | null;
  clientId: string | null;
}

/** Payments matching the filters; a null filter matches everything. */
export function filterPayments<P extends Pick<Payment, 'method' | 'client_id'>>(
  payments: P[],
  { method, clientId }: PaymentFilters,
): P[] {
  return payments.filter(
    (p) =>
      (method === null || p.method === method) && (clientId === null || p.client_id === clientId),
  );
}

/** Newest payment first; same day falls back to creation order, newest first (UUIDv7 ids). */
export function newestFirst<P extends Pick<Payment, 'paid_at' | 'id'>>(payments: P[]): P[] {
  return [...payments].sort(
    (a, b) => b.paid_at.localeCompare(a.paid_at) || b.id.localeCompare(a.id),
  );
}

/** Oldest payment first, the order of a ledger (and the CSV export). */
export function oldestFirst<P extends Pick<Payment, 'paid_at' | 'id'>>(payments: P[]): P[] {
  return newestFirst(payments).reverse();
}

export interface PendingBalance {
  session: Session;
  /** What the client still owes, in the session's currency; always > 0. */
  balance_minor: number;
  currency: Currency;
}

/**
 * Live sessions the client still owes something on (Pendiente or Parcial), oldest first.
 * Paid, free (Sin cobro) and overpaid sessions are left out. Tombstoned payments are ignored.
 */
export function pendingBalances(
  sessions: Iterable<Session>,
  payments: Iterable<PaymentStatusPayment>,
): PendingBalance[] {
  const bySession = new Map<string, PaymentStatusPayment[]>();
  for (const payment of payments) {
    const list = bySession.get(payment.session_id) ?? [];
    list.push(payment);
    bySession.set(payment.session_id, list);
  }
  const pending: PendingBalance[] = [];
  for (const session of sessions) {
    if (session.deleted_at !== null) continue;
    const { balance_minor, currency } = paymentStatus(session, bySession.get(session.id) ?? []);
    if (balance_minor > 0) pending.push({ session, balance_minor, currency });
  }
  return pending.sort(
    (a, b) =>
      a.session.started_at.localeCompare(b.session.started_at) ||
      a.session.id.localeCompare(b.session.id),
  );
}
