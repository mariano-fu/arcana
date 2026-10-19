import type { Currency, IsoDate, Payment, PaymentMethod } from '../../db';
import { formatMoneyInput, parseMoney } from './money';
import type { PaymentStatus } from './status';

/** In the order the picker shows them; SINPE Móvil is what most clients use. */
export const PAYMENT_METHODS = [
  'sinpe',
  'cash',
  'transfer',
  'paypal',
  'other',
] as const satisfies readonly PaymentMethod[];

/** The payment fields she edits in the payment form. */
export type PaymentFields = Pick<
  Payment,
  'amount_minor' | 'currency' | 'method' | 'paid_at' | 'reference' | 'note'
>;

/** Raw values as the inputs hold them. */
export interface PaymentFormValues {
  amount: string;
  currency: Currency;
  method: PaymentMethod;
  paid_at: string;
  reference: string;
  note: string;
}

export interface PaymentFormErrors {
  amount?: boolean;
  paid_at?: boolean;
}

export type PaymentFormResult =
  { ok: true; fields: PaymentFields } | { ok: false; errors: PaymentFormErrors };

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's calendar date in the device's timezone, `YYYY-MM-DD`. */
export function todayLocal(now: Date = new Date()): IsoDate {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True for a real calendar date in `YYYY-MM-DD` form (rejects e.g. `2026-02-30`). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/**
 * A new payment starts in the session's currency, by SINPE Móvil, dated today, for what the
 * client still owes. Nothing owed (no price, already paid) leaves the amount empty.
 */
export function defaultPaymentValues(status: PaymentStatus, today: IsoDate): PaymentFormValues {
  return {
    amount: status.balance_minor > 0 ? formatMoneyInput(status.balance_minor, status.currency) : '',
    currency: status.currency,
    method: 'sinpe',
    paid_at: today,
    reference: '',
    note: '',
  };
}

export function paymentToValues(payment: PaymentFields): PaymentFormValues {
  return {
    amount: formatMoneyInput(payment.amount_minor, payment.currency),
    currency: payment.currency,
    method: payment.method,
    paid_at: payment.paid_at,
    reference: payment.reference ?? '',
    note: payment.note,
  };
}

/** Amount must be more than 0; a blank reference is stored as null. */
export function validatePaymentForm(values: PaymentFormValues): PaymentFormResult {
  const amount = parseMoney(values.amount);
  const errors: PaymentFormErrors = {};
  if (amount === null || amount <= 0) errors.amount = true;
  if (!isIsoDate(values.paid_at)) errors.paid_at = true;
  if (amount === null || Object.keys(errors).length > 0) return { ok: false, errors };

  const reference = values.reference.trim();
  return {
    ok: true,
    fields: {
      amount_minor: amount,
      currency: values.currency,
      method: values.method,
      paid_at: values.paid_at,
      reference: reference === '' ? null : reference,
      note: values.note.trim(),
    },
  };
}
