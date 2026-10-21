import {
  db,
  forgetDeviceId,
  repos,
  type Client,
  type NewRow,
  type Payment,
  type Session,
} from '../../db';

/** Fake data only: never real clients in tests (CLAUDE.md). */
export function newClient(overrides: Partial<NewRow<Client>> = {}): NewRow<Client> {
  return {
    name: 'Cliente de prueba',
    instagram: null,
    whatsapp: null,
    email: null,
    birth_date: null,
    birth_time: null,
    birth_place_label: null,
    birth_lat: null,
    birth_lng: null,
    birth_tz: null,
    notes: '',
    tags: [],
    archived: false,
    created_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

export function newSession(
  clientId: string,
  overrides: Partial<NewRow<Session>> = {},
): NewRow<Session> {
  return {
    client_id: clientId,
    started_at: '2026-10-10T15:00:00.000Z',
    type: 'in_person',
    price_minor: null,
    currency: 'CRC',
    notes: '',
    follow_up_note: '',
    follow_up_date: null,
    ...overrides,
  };
}

export function newPayment(
  session: Session,
  overrides: Partial<NewRow<Payment>> = {},
): NewRow<Payment> {
  return {
    session_id: session.id,
    client_id: session.client_id,
    amount_minor: 1500000,
    currency: 'CRC',
    method: 'sinpe',
    paid_at: '2026-10-10',
    reference: null,
    note: '',
    ...overrides,
  };
}

/**
 * A fresh, empty database. Synced tables refuse hard deletes (db/monotonic.ts), so instead of
 * clearing tables the database is deleted and reopened.
 */
export async function clearDb(): Promise<void> {
  await db.delete();
  forgetDeviceId(db);
  await db.open();
}

/** A client with `sessions` sessions and the given payments spread over the first session. */
export async function seedClientWithHistory(
  name: string,
  sessions: number,
  payments: Partial<NewRow<Payment>>[],
): Promise<Client> {
  const client = await repos.client.create(newClient({ name }));
  const created: Session[] = [];
  for (let i = 0; i < sessions; i++) {
    created.push(await repos.session.create(newSession(client.id)));
  }
  const first = created[0];
  if (payments.length > 0 && !first) throw new Error('Payments need at least one session');
  for (const payment of payments) {
    if (first) await repos.payment.create(newPayment(first, payment));
  }
  return client;
}
