// Money helpers. Amounts are always integer minor units (céntimos/cents), never floats.

import type { Currency } from '../../db';

export const CURRENCIES = ['CRC', 'USD'] as const satisfies readonly Currency[];

/** Display symbols. es-CR's Intl output uses `USD`/`$`, but she writes `US$`. */
export const CURRENCY_SYMBOL: Record<Currency, string> = { CRC: '₡', USD: 'US$' };

/** Both currencies have two minor-unit digits (céntimos, cents). */
const MINOR_PER_MAJOR = 100;

/** True for a safe integer, i.e. a valid amount in minor units (may be negative, e.g. a balance). */
export function isMinorAmount(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

export function assertMinorAmount(value: number, label = 'amount'): void {
  if (!isMinorAmount(value)) {
    throw new RangeError(`${label} must be an integer in minor units, got ${String(value)}`);
  }
}

/** Totals per currency. Currencies are never summed together, so there is no grand total. */
export type CurrencyTotals = Partial<Record<Currency, number>>;

/** Sums amounts per currency. Currencies with no items are left out. */
export function sumByCurrency(
  items: Iterable<{ amount_minor: number; currency: Currency }>,
): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const { amount_minor, currency } of items) {
    assertMinorAmount(amount_minor, 'amount_minor');
    totals[currency] = (totals[currency] ?? 0) + amount_minor;
  }
  return totals;
}

const formatters: Record<Currency, Intl.NumberFormat> = {
  CRC: new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }),
  USD: new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'USD' }),
};
const wholeColones = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  maximumFractionDigits: 0,
});

/**
 * Formats minor units for display in es-CR, e.g. `₡15 000`, `₡15 000,50`, `US$40,00`.
 * Colones drop `,00` on whole amounts (nobody writes céntimos); dollars always show cents.
 * Grouping uses a no-break space, so an amount never wraps across lines.
 */
export function formatMoney(amountMinor: number, currency: Currency): string {
  assertMinorAmount(amountMinor);
  const whole = amountMinor % MINOR_PER_MAJOR === 0;
  // Dividing a safe integer by 100 and rounding to 2 decimals recovers it exactly; this float
  // only exists for display.
  const value = amountMinor / MINOR_PER_MAJOR;
  const formatter = currency === 'CRC' && whole ? wholeColones : formatters[currency];
  const parts = formatter.formatToParts(value);
  let out = '';
  let afterSymbol = false;
  for (const part of parts) {
    if (part.type === 'currency') {
      out += CURRENCY_SYMBOL[currency];
      afterSymbol = true;
      continue;
    }
    // Intl puts a space between `USD` and the number; `US$` sits right next to it.
    if (afterSymbol && part.type === 'literal' && part.value.trim() === '') continue;
    afterSymbol = false;
    out += part.value;
  }
  return out;
}

const SYMBOLS = /^(?:US\$|USD|CRC|₡|\$)\s*/i;
// `\s` also matches the no-break spaces Intl uses for grouping (U+00A0, U+202F).
const SPACES = /\s/g;

/**
 * Parses what she types in an amount field into minor units, without float math.
 * Accepts an optional symbol and es-CR style: spaces group thousands, comma is the decimal
 * separator (`15 000`, `₡15 000,50`, `40,5`). Dots are read as thousands separators when every
 * dot is followed by exactly 3 digits (`15.000`), otherwise a single dot is a decimal point
 * (`40.50`). Returns null for empty, negative, malformed input or more than 2 decimals.
 */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(SYMBOLS, '').replace(SPACES, '');
  if (s === '') return null;

  if (s.includes(',')) {
    // Comma is the decimal separator; any dots are grouping.
    s = s.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    if (s.includes('.')) return null;
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const [, intPart, fracPart = ''] = match;
  const minor = Number(intPart) * MINOR_PER_MAJOR + Number(fracPart.padEnd(2, '0'));
  return isMinorAmount(minor) ? minor : null;
}
