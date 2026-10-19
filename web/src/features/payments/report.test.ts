import type { Payment, Session } from '../../db';
import {
  currentMonth,
  filterPayments,
  formatMonth,
  isMonth,
  monthIncome,
  monthRange,
  newestFirst,
  oldestFirst,
  pendingBalances,
  shiftMonth,
} from './report';

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    client_id: 'c1',
    started_at: '2026-10-10T15:00:00.000Z',
    type: 'in_person',
    price_minor: 1_500_000,
    currency: 'CRC',
    notes: '',
    follow_up_note: '',
    follow_up_date: null,
    updated_at: '2026-10-10T15:00:00.000Z',
    deleted_at: null,
    server_version: null,
    device_id: 'd1',
    pending: 1,
    ...overrides,
  };
}

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    session_id: 's1',
    client_id: 'c1',
    amount_minor: 1_500_000,
    currency: 'CRC',
    method: 'sinpe',
    paid_at: '2026-10-10',
    reference: null,
    note: '',
    updated_at: '2026-10-10T15:00:00.000Z',
    deleted_at: null,
    server_version: null,
    device_id: 'd1',
    pending: 1,
    ...overrides,
  };
}

describe('months', () => {
  it('takes the current month from the device clock', () => {
    expect(currentMonth(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
    expect(currentMonth(new Date(2026, 11, 1))).toBe('2026-12');
  });

  it('accepts only real YYYY-MM months', () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-12')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '202610', '2026-10-01', '']) {
      expect(isMonth(bad)).toBe(false);
    }
  });

  it('moves across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', -14)).toBe('2025-08');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });

  it('covers every day of the month, February included', () => {
    const [first, last] = monthRange('2026-02');
    for (const date of ['2026-02-01', '2026-02-28']) {
      expect(date >= first && date <= last).toBe(true);
    }
    for (const date of ['2026-01-31', '2026-03-01']) {
      expect(date >= first && date <= last).toBe(false);
    }
  });

  it('formats a month in Spanish', () => {
    expect(formatMonth('2026-10')).toBe('octubre de 2026');
    expect(formatMonth('2027-01')).toBe('enero de 2027');
  });
});

describe('monthIncome', () => {
  it('totals per currency without mixing them, ignoring tombstones', () => {
    expect(
      monthIncome([
        payment('p1', { amount_minor: 1_500_000 }),
        payment('p2', { amount_minor: 500_050 }),
        payment('p3', { amount_minor: 4_000, currency: 'USD' }),
        payment('p4', { amount_minor: 999, deleted_at: '2026-10-11T00:00:00.000Z' }),
      ]),
    ).toEqual({ CRC: 2_000_050, USD: 4_000 });
  });

  it('is empty for a month without payments', () => {
    expect(monthIncome([])).toEqual({});
  });
});

describe('filterPayments', () => {
  const payments = [
    payment('p1', { method: 'sinpe', client_id: 'c1' }),
    payment('p2', { method: 'cash', client_id: 'c1' }),
    payment('p3', { method: 'sinpe', client_id: 'c2' }),
  ];
  const ids = (list: Payment[]) => list.map((p) => p.id);

  it('keeps everything without filters', () => {
    expect(ids(filterPayments(payments, { method: null, clientId: null }))).toEqual([
      'p1',
      'p2',
      'p3',
    ]);
  });

  it('filters by method, client, or both', () => {
    expect(ids(filterPayments(payments, { method: 'sinpe', clientId: null }))).toEqual([
      'p1',
      'p3',
    ]);
    expect(ids(filterPayments(payments, { method: null, clientId: 'c1' }))).toEqual(['p1', 'p2']);
    expect(ids(filterPayments(payments, { method: 'sinpe', clientId: 'c1' }))).toEqual(['p1']);
    expect(ids(filterPayments(payments, { method: 'paypal', clientId: null }))).toEqual([]);
  });
});

describe('payment order', () => {
  const payments = [
    payment('p1', { paid_at: '2026-10-05' }),
    payment('p3', { paid_at: '2026-10-20' }),
    payment('p2', { paid_at: '2026-10-05' }),
  ];

  it('sorts by date, then by creation order, without mutating the input', () => {
    expect(newestFirst(payments).map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
    expect(oldestFirst(payments).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(payments.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
  });
});

describe('pendingBalances', () => {
  it('lists pending and partial sessions, oldest first, with what is still owed', () => {
    const sessions = [
      session('s-new', { started_at: '2026-10-15T15:00:00.000Z' }),
      session('s-old', {
        started_at: '2026-08-01T15:00:00.000Z',
        currency: 'USD',
        price_minor: 4_000,
      }),
      session('s-mid', { started_at: '2026-09-01T15:00:00.000Z' }),
    ];
    const payments = [payment('p1', { session_id: 's-mid', amount_minor: 1_000_000 })];

    expect(
      pendingBalances(sessions, payments).map((b) => [b.session.id, b.balance_minor, b.currency]),
    ).toEqual([
      ['s-old', 4_000, 'USD'],
      ['s-mid', 500_000, 'CRC'],
      ['s-new', 1_500_000, 'CRC'],
    ]);
  });

  it('leaves out paid, overpaid, free and deleted sessions', () => {
    const sessions = [
      session('paid'),
      session('overpaid'),
      session('free', { price_minor: null }),
      session('zero', { price_minor: 0 }),
      session('deleted', { deleted_at: '2026-10-11T00:00:00.000Z' }),
    ];
    const payments = [
      payment('p1', { session_id: 'paid' }),
      payment('p2', { session_id: 'overpaid', amount_minor: 2_000_000 }),
    ];
    expect(pendingBalances(sessions, payments)).toEqual([]);
  });

  it('ignores tombstoned payments and payments in another currency', () => {
    const sessions = [session('s1')];
    const payments = [
      payment('p1', { deleted_at: '2026-10-11T00:00:00.000Z' }),
      payment('p2', { currency: 'USD', amount_minor: 4_000 }),
    ];
    expect(pendingBalances(sessions, payments).map((b) => b.balance_minor)).toEqual([1_500_000]);
  });
});
