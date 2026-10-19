// A client's payment totals for their profile. Currencies are never summed together.

import { sumByCurrency, type CurrencyTotals } from './money';
import { paymentStatus, type PaymentStatusPayment, type PaymentStatusSession } from './status';

export interface ClientPaymentTotals {
  /** Every live payment, per currency. */
  paid: CurrencyTotals;
  /** What the client still owes: positive session balances, per session currency. */
  pending: CurrencyTotals;
  /**
   * Overpayments (saldo a favor), per session currency. Kept apart from `pending` and never
   * netted against it, so each open session stays visible.
   */
  credit: CurrencyTotals;
}

/**
 * Totals across the client's sessions. Callers pass live sessions; tombstoned payments and
 * payments for sessions not passed are ignored.
 */
export function clientPaymentTotals(
  sessions: Iterable<PaymentStatusSession>,
  payments: Iterable<PaymentStatusPayment>,
): ClientPaymentTotals {
  const sessionList = [...sessions];
  const ids = new Set(sessionList.map((session) => session.id));
  const live = [...payments].filter((p) => p.deleted_at === null && ids.has(p.session_id));

  const pending: { amount_minor: number; currency: PaymentStatusSession['currency'] }[] = [];
  const credit: typeof pending = [];
  for (const session of sessionList) {
    const { balance_minor, currency } = paymentStatus(session, live);
    if (balance_minor > 0) pending.push({ amount_minor: balance_minor, currency });
    if (balance_minor < 0) credit.push({ amount_minor: -balance_minor, currency });
  }
  return {
    paid: sumByCurrency(live),
    pending: sumByCurrency(pending),
    credit: sumByCurrency(credit),
  };
}
