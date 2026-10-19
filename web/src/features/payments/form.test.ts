import {
  defaultPaymentValues,
  isIsoDate,
  paymentStatus,
  paymentToValues,
  todayLocal,
  validatePaymentForm,
  type PaymentFormValues,
} from '.';

const NBSP = ' ';

const values = (overrides: Partial<PaymentFormValues> = {}): PaymentFormValues => ({
  amount: '15 000',
  currency: 'CRC',
  method: 'sinpe',
  paid_at: '2026-10-19',
  reference: '',
  note: '',
  ...overrides,
});

describe('todayLocal', () => {
  it("formats the device's calendar date", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('isIsoDate', () => {
  it('accepts real dates only', () => {
    expect(isIsoDate('2026-10-19')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('19/10/2026')).toBe(false);
  });
});

describe('defaultPaymentValues', () => {
  const session = { id: 's1', price_minor: 1_500_000, currency: 'CRC' as const };

  it('defaults to SINPE Móvil, today, and what is still owed in the session currency', () => {
    const status = paymentStatus(session, [
      { session_id: 's1', amount_minor: 1_000_000, currency: 'CRC', deleted_at: null },
    ]);
    expect(defaultPaymentValues(status, '2026-10-19')).toEqual({
      amount: `5${NBSP}000`,
      currency: 'CRC',
      method: 'sinpe',
      paid_at: '2026-10-19',
      reference: '',
      note: '',
    });
  });

  it('uses the session currency', () => {
    const status = paymentStatus({ id: 's1', price_minor: 4_050, currency: 'USD' }, []);
    expect(defaultPaymentValues(status, '2026-10-19')).toMatchObject({
      amount: '40,50',
      currency: 'USD',
    });
  });

  it('leaves the amount empty when nothing is owed', () => {
    const free = paymentStatus({ ...session, price_minor: null }, []);
    expect(defaultPaymentValues(free, '2026-10-19').amount).toBe('');
    const paid = paymentStatus(session, [
      { session_id: 's1', amount_minor: 2_000_000, currency: 'CRC', deleted_at: null },
    ]);
    expect(defaultPaymentValues(paid, '2026-10-19').amount).toBe('');
  });
});

describe('validatePaymentForm', () => {
  it('turns the inputs into payment fields', () => {
    expect(
      validatePaymentForm(
        values({ amount: '₡15 000,50', reference: ' 12345678 ', note: ' Adelanto ' }),
      ),
    ).toEqual({
      ok: true,
      fields: {
        amount_minor: 1_500_050,
        currency: 'CRC',
        method: 'sinpe',
        paid_at: '2026-10-19',
        reference: '12345678',
        note: 'Adelanto',
      },
    });
  });

  it('stores a blank reference as null', () => {
    const result = validatePaymentForm(values({ reference: '   ' }));
    expect(result.ok && result.fields.reference).toBeNull();
  });

  it('rejects empty, zero, negative and malformed amounts', () => {
    for (const amount of ['', '0', '0,00', '-500', 'quince', '1,234']) {
      expect(validatePaymentForm(values({ amount }))).toEqual({
        ok: false,
        errors: { amount: true },
      });
    }
  });

  it('rejects a missing or invalid date', () => {
    expect(validatePaymentForm(values({ paid_at: '' }))).toEqual({
      ok: false,
      errors: { paid_at: true },
    });
    expect(validatePaymentForm(values({ amount: '', paid_at: '2026-02-30' }))).toEqual({
      ok: false,
      errors: { amount: true, paid_at: true },
    });
  });

  it('round-trips a stored payment through the form', () => {
    const fields = {
      amount_minor: 123_456,
      currency: 'USD' as const,
      method: 'paypal' as const,
      paid_at: '2026-10-01',
      reference: null,
      note: 'Propina',
    };
    expect(validatePaymentForm(paymentToValues(fields))).toEqual({ ok: true, fields });
  });
});
