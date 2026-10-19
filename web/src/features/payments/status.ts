// Session payment status, derived from price vs. payments and never stored (specs/plan.md,
// "payment"), so it can't drift out of sync.

import type { Currency, Payment, Session } from '../../db';
import { assertMinorAmount, sumByCurrency, type CurrencyTotals } from './money';

export type PaymentStatusKind = 'paid' | 'partial' | 'pending' | 'no_charge' | 'overpaid';

export interface PaymentStatus {
  status: PaymentStatusKind;
  /** The session's currency; `price_minor`, `paid_minor` and `balance_minor` are in it. */
  currency: Currency;
  /** 0 when no price was set. */
  price_minor: number;
  /** Sum of live payments in the session's currency. */
  paid_minor: number;
  /** `price - paid`: what the client still owes. Negative means saldo a favor; 0 for no_charge. */
  balance_minor: number;
  /**
   * Live payments in a currency other than the session's. Shown to her but never converted
   * or counted toward the status, since currencies are never summed together.
   */
  other_currency_paid: CurrencyTotals;
}

export type PaymentStatusSession = Pick<Session, 'id' | 'price_minor' | 'currency'>;
export type PaymentStatusPayment = Pick<
  Payment,
  'session_id' | 'amount_minor' | 'currency' | 'deleted_at'
>;

/**
 * Derives a session's payment status. Tombstoned payments and payments for other sessions are
 * ignored, so callers can pass a client's whole payment list. A session without a price (or a
 * price of 0) is a free reading, `no_charge`, even if something was paid (e.g. a tip).
 */
export function paymentStatus(
  session: PaymentStatusSession,
  payments: Iterable<PaymentStatusPayment>,
): PaymentStatus {
  const price = session.price_minor ?? 0;
  assertMinorAmount(price, 'price_minor');
  if (price < 0) throw new RangeError(`price_minor must not be negative, got ${String(price)}`);

  const live = [...payments].filter((p) => p.session_id === session.id && p.deleted_at === null);
  for (const p of live) {
    if (p.amount_minor < 0) {
      throw new RangeError(`amount_minor must not be negative, got ${String(p.amount_minor)}`);
    }
  }
  const totals = sumByCurrency(live);
  const paid = totals[session.currency] ?? 0;
  const other_currency_paid: CurrencyTotals = Object.fromEntries(
    Object.entries(totals).filter(([currency]) => currency !== session.currency),
  );

  const base = {
    currency: session.currency,
    price_minor: price,
    paid_minor: paid,
    other_currency_paid,
  };
  if (price === 0) return { ...base, status: 'no_charge', balance_minor: 0 };

  const balance = price - paid;
  const status: PaymentStatusKind =
    paid === 0 ? 'pending' : balance > 0 ? 'partial' : balance === 0 ? 'paid' : 'overpaid';
  return { ...base, status, balance_minor: balance };
}

/** i18n key for a status label (`es.json`, `payments.status.*`). */
export function paymentStatusKey(status: PaymentStatusKind) {
  return `payments.status.${status}` as const;
}
