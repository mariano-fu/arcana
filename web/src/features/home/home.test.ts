import type { Client, Session } from '../../db';
import { newClient, newSession } from '../clients/test-utils';
import {
  balanceTotals,
  daysBetween,
  followUps,
  OVERDUE_DAYS,
  recentSessions,
  UPCOMING_DAYS,
} from './home';

const row = {
  updated_at: '2026-10-01T00:00:00.000Z',
  device_id: 'd',
  pending: 0 as const,
  deleted_at: null,
  server_version: null,
};

function client(id: string, overrides: Partial<Client> = {}): Client {
  return {
    ...newClient({ name: id }),
    ...row,
    id,
    created_at: row.updated_at,
    ...overrides,
  };
}

function session(id: string, clientId: string, overrides: Partial<Session> = {}): Session {
  return { ...newSession(clientId), ...row, id, ...overrides };
}

const byId = (...clients: Client[]) => new Map(clients.map((c) => [c.id, c]));
const TODAY = '2026-10-31';

describe('daysBetween', () => {
  it('counts calendar days across month, leap-year and year ends', () => {
    expect(daysBetween('2026-10-31', '2026-10-31')).toBe(0);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-10-31')).toBe(-1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-31', '2026-03-02')).toBe(30);
  });
});

describe('followUps', () => {
  const ana = client('Ana');
  const at = (date: string, id = date) =>
    session(id, 'Ana', { follow_up_date: date, started_at: `2026-09-01T15:00:00.000Z` });

  it('labels today, tomorrow and overdue days', () => {
    const items = followUps(
      [
        session('a', 'Ana', { follow_up_date: '2026-10-31' }),
        session('b', 'Bea', { follow_up_date: '2026-11-01' }),
        session('c', 'Caro', { follow_up_date: '2026-10-30' }),
      ],
      byId(ana, client('Bea'), client('Caro')),
      TODAY,
    );
    expect(items.map((f) => [f.session.id, f.days])).toEqual([
      ['c', -1],
      ['a', 0],
      ['b', 1],
    ]);
  });

  it(`shows a follow-up up to ${String(OVERDUE_DAYS)} days overdue, not one day more`, () => {
    expect(followUps([at('2026-10-01')], byId(ana), TODAY).map((f) => f.days)).toEqual([-30]);
    expect(followUps([at('2026-09-30')], byId(ana), TODAY)).toEqual([]);
  });

  it(`shows a follow-up up to ${String(UPCOMING_DAYS)} days ahead, not one day more`, () => {
    expect(followUps([at('2026-11-30')], byId(ana), TODAY).map((f) => f.days)).toEqual([30]);
    expect(followUps([at('2026-12-01')], byId(ana), TODAY)).toEqual([]);
  });

  it('sorts overdue oldest first, then today, then soonest; ties by client name', () => {
    const names = ['Bea', 'Ana', 'Ángela', 'Caro', 'Dora'];
    const items = followUps(
      [
        session('1', 'Bea', { follow_up_date: '2026-11-05' }),
        session('2', 'Ana', { follow_up_date: '2026-10-20' }),
        session('3', 'Caro', { follow_up_date: '2026-10-31' }),
        session('4', 'Ángela', { follow_up_date: '2026-10-31' }),
        session('5', 'Dora', { follow_up_date: '2026-10-10' }),
      ],
      byId(...names.map((name) => client(name))),
      TODAY,
    );
    expect(items.map((f) => f.session.id)).toEqual(['5', '2', '4', '3', '1']);
  });

  it('counts a follow-up as handled only by a session that started later, same day included', () => {
    const followUp = session('f', 'Ana', {
      follow_up_date: '2026-10-25',
      started_at: '2026-10-01T15:00:00.000Z',
    });
    const earlier = session('e', 'Ana', { started_at: '2026-10-01T14:00:00.000Z' });
    const later = session('l', 'Ana', { started_at: '2026-10-01T16:00:00.000Z' });
    expect(followUps([followUp, earlier], byId(ana), TODAY).map((f) => f.session.id)).toEqual([
      'f',
    ]);
    expect(followUps([followUp, later], byId(ana), TODAY)).toEqual([]);
    // Another client's later session doesn't count, nor a deleted one.
    const other = session('o', 'Bea', { started_at: '2026-10-02T00:00:00.000Z' });
    const deleted = { ...later, deleted_at: '2026-10-02T00:00:00.000Z' };
    expect(followUps([followUp, other, deleted], byId(ana, client('Bea')), TODAY)).toHaveLength(1);
  });

  it('hides archived and missing clients, deleted sessions and sessions without a date', () => {
    const items = followUps(
      [
        session('archived', 'Arc', { follow_up_date: TODAY }),
        session('missing', 'Nadie', { follow_up_date: TODAY }),
        session('deleted', 'Ana', { follow_up_date: TODAY, deleted_at: TODAY }),
        session('none', 'Ana', {
          follow_up_note: 'Llamar',
          follow_up_date: null,
          started_at: '2026-01-01T00:00:00.000Z',
        }),
      ],
      byId(ana, client('Arc', { archived: true })),
      TODAY,
    );
    expect(items).toEqual([]);
  });
});

describe('recentSessions', () => {
  it('lists the newest live sessions of known clients, archived included', () => {
    const clients = byId(client('Ana'), client('Arc', { archived: true }));
    const sessions = Array.from({ length: 7 }, (_, i) =>
      session(`s${String(i)}`, i === 6 ? 'Arc' : 'Ana', {
        started_at: `2026-10-0${String(i + 1)}T15:00:00.000Z`,
      }),
    );
    sessions.push(
      session('gone', 'Ana', { started_at: '2026-10-09T15:00:00.000Z', deleted_at: TODAY }),
    );
    sessions.push(session('orphan', 'Nadie', { started_at: '2026-10-09T15:00:00.000Z' }));
    expect(recentSessions(sessions, clients).map((r) => r.session.id)).toEqual([
      's6',
      's5',
      's4',
      's3',
      's2',
    ]);
  });
});

describe('balanceTotals', () => {
  it('totals each currency on its own', () => {
    const owed = (balance_minor: number, currency: 'CRC' | 'USD') => ({
      session: session('x', 'Ana'),
      balance_minor,
      currency,
    });
    expect(
      balanceTotals([owed(1_500_000, 'CRC'), owed(4_000, 'USD'), owed(500_000, 'CRC')]),
    ).toEqual({
      CRC: 2_000_000,
      USD: 4_000,
    });
    expect(balanceTotals([])).toEqual({});
  });
});
