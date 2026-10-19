import i18n from '../../i18n';
import {
  paymentStatus,
  paymentStatusKey,
  type PaymentStatusKind,
  type PaymentStatusPayment,
  type PaymentStatusSession,
} from '.';

const session = (overrides: Partial<PaymentStatusSession> = {}): PaymentStatusSession => ({
  id: 's1',
  price_minor: 2_000_000, // ₡20 000
  currency: 'CRC',
  ...overrides,
});

const payment = (overrides: Partial<PaymentStatusPayment> = {}): PaymentStatusPayment => ({
  session_id: 's1',
  amount_minor: 2_000_000,
  currency: 'CRC',
  deleted_at: null,
  ...overrides,
});

describe('paymentStatus', () => {
  it('is pending with no payments', () => {
    expect(paymentStatus(session(), [])).toEqual({
      status: 'pending',
      currency: 'CRC',
      price_minor: 2_000_000,
      paid_minor: 0,
      balance_minor: 2_000_000,
      other_currency_paid: {},
    });
  });

  it('is paid when payments match the price exactly', () => {
    const s = paymentStatus(session(), [payment()]);
    expect(s.status).toBe('paid');
    expect(s.balance_minor).toBe(0);
  });

  it('is partial after a deposit, and paid once the rest comes in', () => {
    const deposit = payment({ amount_minor: 500_000 });
    const partial = paymentStatus(session(), [deposit]);
    expect(partial).toMatchObject({
      status: 'partial',
      paid_minor: 500_000,
      balance_minor: 1_500_000,
    });

    const rest = payment({ amount_minor: 1_500_000 });
    expect(paymentStatus(session(), [deposit, rest]).status).toBe('paid');
  });

  it('is overpaid with a negative balance (saldo a favor)', () => {
    const s = paymentStatus(session(), [payment(), payment({ amount_minor: 300_000 })]);
    expect(s).toMatchObject({ status: 'overpaid', paid_minor: 2_300_000, balance_minor: -300_000 });
  });

  it('is partial when one céntimo short', () => {
    expect(paymentStatus(session(), [payment({ amount_minor: 1_999_999 })]).status).toBe('partial');
  });

  describe('mixed currencies', () => {
    it('never counts another currency toward the balance', () => {
      const s = paymentStatus(session(), [payment({ amount_minor: 4_000, currency: 'USD' })]);
      expect(s).toMatchObject({
        status: 'pending',
        paid_minor: 0,
        balance_minor: 2_000_000,
        other_currency_paid: { USD: 4_000 },
      });
    });

    it('reports other-currency payments next to a partial balance', () => {
      const s = paymentStatus(session(), [
        payment({ amount_minor: 1_000_000 }),
        payment({ amount_minor: 2_000, currency: 'USD' }),
        payment({ amount_minor: 1_500, currency: 'USD' }),
      ]);
      expect(s).toMatchObject({
        status: 'partial',
        paid_minor: 1_000_000,
        other_currency_paid: { USD: 3_500 },
      });
    });

    it('works for a dollar session', () => {
      const s = paymentStatus(session({ price_minor: 4_000, currency: 'USD' }), [
        payment({ amount_minor: 4_000, currency: 'USD' }),
        payment({ amount_minor: 500_000, currency: 'CRC' }),
      ]);
      expect(s).toMatchObject({
        status: 'paid',
        currency: 'USD',
        balance_minor: 0,
        other_currency_paid: { CRC: 500_000 },
      });
    });
  });

  describe('free reading', () => {
    it('is no_charge when there is no price', () => {
      expect(paymentStatus(session({ price_minor: null }), [])).toEqual({
        status: 'no_charge',
        currency: 'CRC',
        price_minor: 0,
        paid_minor: 0,
        balance_minor: 0,
        other_currency_paid: {},
      });
    });

    it('is no_charge when the price is 0', () => {
      expect(paymentStatus(session({ price_minor: 0 }), []).status).toBe('no_charge');
    });

    it('stays no_charge when something was paid anyway, and still reports it', () => {
      const s = paymentStatus(session({ price_minor: null }), [payment({ amount_minor: 200_000 })]);
      expect(s).toMatchObject({ status: 'no_charge', paid_minor: 200_000, balance_minor: 0 });
    });
  });

  it('ignores tombstoned payments and payments for other sessions', () => {
    const s = paymentStatus(session(), [
      payment({ deleted_at: '2026-10-18T14:03:00.000Z' }),
      payment({ session_id: 's2' }),
      payment({ amount_minor: 500_000 }),
    ]);
    expect(s).toMatchObject({ status: 'partial', paid_minor: 500_000 });
  });

  it('rejects float or negative amounts instead of guessing', () => {
    expect(() => paymentStatus(session({ price_minor: 20000.5 }), [])).toThrow(RangeError);
    expect(() => paymentStatus(session({ price_minor: -1 }), [])).toThrow(RangeError);
    expect(() => paymentStatus(session(), [payment({ amount_minor: 10.5 })])).toThrow(RangeError);
    expect(() => paymentStatus(session(), [payment({ amount_minor: -100 })])).toThrow(RangeError);
  });
});

describe('paymentStatusKey', () => {
  it('has a Spanish label for every status', () => {
    const kinds: PaymentStatusKind[] = ['paid', 'partial', 'pending', 'no_charge', 'overpaid'];
    const labels = kinds.map((k) => i18n.t(paymentStatusKey(k)));
    expect(labels).toEqual(['Pagado', 'Parcial', 'Pendiente', 'Sin cobro', 'Saldo a favor']);
  });
});
