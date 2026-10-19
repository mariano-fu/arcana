// CSV export of a month's payments, for her own records and taxes (US-2b.6).
// Shaped for Excel / Numbers in Spanish: UTF-8 with BOM (so accents survive), `;` separator
// (the comma is the decimal separator), amounts like `15000,00` so they stay numbers.

import type { Payment, PaymentMethod } from '../../db';
import { assertMinorAmount } from './money';
import { oldestFirst } from './report';

const BOM = '\uFEFF';
const SEPARATOR = ';';
const NEWLINE = '\r\n';

export interface PaymentsCsvLabels {
  /** Column headers: date, client, amount, currency, method, reference, note. */
  headers: readonly [string, string, string, string, string, string, string];
  method: Record<PaymentMethod, string>;
  /** Shown when a payment's client can't be found. */
  unknownClient: string;
}

/** `1500050` → `15000,50`: no symbol, no grouping, comma decimals. Integer math only. */
export function formatCsvAmount(amountMinor: number): string {
  assertMinorAmount(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  return `${sign}${String(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Quotes a cell when needed (separator, quote, line break) and defuses spreadsheet formulas:
 * text starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The month's payments as CSV text, oldest first, BOM included. */
export function buildPaymentsCsv(
  payments: Payment[],
  clientNames: ReadonlyMap<string, string>,
  labels: PaymentsCsvLabels,
): string {
  const rows = oldestFirst(payments).map((p) => [
    csvCell(p.paid_at),
    csvCell(clientNames.get(p.client_id) ?? labels.unknownClient),
    formatCsvAmount(p.amount_minor),
    p.currency,
    csvCell(labels.method[p.method]),
    csvCell(p.reference ?? ''),
    csvCell(p.note),
  ]);
  const lines = [labels.headers.map(csvCell), ...rows].map((row) => row.join(SEPARATOR));
  return BOM + lines.join(NEWLINE) + NEWLINE;
}
