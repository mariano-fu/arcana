import { clientPaymentTotals, type PaymentStatusPayment, type PaymentStatusSession } from '.';

const session = (id: string, overrides: Partial<PaymentStatusSession> = {}) => ({
  id,
  price_minor: 2_000_000, // ₡20 000
  currency: 'CRC' as const,
  ...overrides,
});

const payment = (
  session_id: string,
  amount_minor: number,
  overrides: Partial<PaymentStatusPayment> = {},
): PaymentStatusPayment => ({
  session_id,
  amount_minor,
  currency: 'CRC',
  deleted_at: null,
  ...overrides,
});

describe('clientPaymentTotals', () => {
  it('is empty with no sessions or payments', () => {
    expect(clientPaymentTotals([], [])).toEqual({ paid: {}, pending: {}, credit: {} });
  });

  it('sums payments and pending balances per currency', () => {
    const totals = clientPaymentTotals(
      [session('a'), session('b'), session('c', { price_minor: 5_000, currency: 'USD' })],
      [payment('a', 500_000), payment('c', 2_000, { currency: 'USD' })],
    );
    expect(totals).toEqual({
      paid: { CRC: 500_000, USD: 2_000 },
      pending: { CRC: 1_500_000 + 2_000_000, USD: 3_000 },
      credit: {},
    });
  });

  it('keeps saldo a favor apart and never nets it against what is owed', () => {
    const totals = clientPaymentTotals(
      [session('over'), session('owed')],
      [payment('over', 2_200_000)],
    );
    expect(totals.pending).toEqual({ CRC: 2_000_000 });
    expect(totals.credit).toEqual({ CRC: 200_000 });
  });

  it('does not count a payment in another currency toward the balance', () => {
    const totals = clientPaymentTotals([session('a')], [payment('a', 4_000, { currency: 'USD' })]);
    expect(totals).toEqual({ paid: { USD: 4_000 }, pending: { CRC: 2_000_000 }, credit: {} });
  });

  it('ignores free sessions, tombstones and payments for sessions not passed', () => {
    const totals = clientPaymentTotals(
      [session('free', { price_minor: null }), session('a')],
      [
        payment('free', 300_000),
        payment('a', 2_000_000, { deleted_at: '2026-10-19T00:00:00.000Z' }),
        payment('deleted-session', 900_000),
      ],
    );
    expect(totals).toEqual({ paid: { CRC: 300_000 }, pending: { CRC: 2_000_000 }, credit: {} });
  });
});
