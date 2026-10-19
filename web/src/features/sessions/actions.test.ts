import { db, repos, type Session } from '../../db';
import { clearDb, newClient, newPayment } from '../clients/test-utils';
import {
  createSession,
  deleteSession,
  discardIfUntouched,
  getSessionDeletionSummary,
} from './actions';
import { defaultSessionFields, pickSessionFields } from './form';

const NOW = '2026-10-19T15:00:00.000Z';
const clock = () => NOW;

beforeEach(clearDb);

async function addReading(session: Session) {
  const reading = await repos.reading.create({
    session_id: session.id,
    spread_template_id: 'template',
    spread_snapshot: { name: '1 carta', positions: [] },
    label: null,
    created_at: NOW,
  });
  const draw = await repos.card_draw.create({
    reading_id: reading.id,
    position_index: 1,
    card_id: 'major-00',
    reversed: false,
    note: '',
  });
  return { reading, draw };
}

describe('createSession', () => {
  it('starts now, in person, with no price, in colones', async () => {
    const client = await repos.client.create(newClient());

    const { session, unarchived } = await createSession(db, client.id, clock);

    expect(unarchived).toBe(false);
    expect(session).toMatchObject({ client_id: client.id, pending: 1, deleted_at: null });
    expect(pickSessionFields(session)).toEqual(defaultSessionFields(NOW));
    expect(await repos.session.get(session.id)).toEqual(session);
    expect((await repos.client.get(client.id))?.updated_at).toBe(client.updated_at);
  });

  it('unarchives an archived client', async () => {
    const client = await repos.client.create(newClient({ archived: true }));

    const { unarchived } = await createSession(db, client.id, clock);

    expect(unarchived).toBe(true);
    expect(await repos.client.get(client.id)).toMatchObject({
      archived: false,
      updated_at: NOW,
      pending: 1,
    });
  });

  it('refuses a deleted client', async () => {
    const client = await repos.client.create(newClient());
    await repos.client.remove(client.id);

    await expect(createSession(db, client.id)).rejects.toThrow();
  });
});

describe('getSessionDeletionSummary', () => {
  it('counts live readings and payments, with totals per currency', async () => {
    const client = await repos.client.create(newClient());
    const { session } = await createSession(db, client.id);
    await addReading(session);
    await repos.payment.create(newPayment(session, { amount_minor: 1000000, currency: 'CRC' }));
    await repos.payment.create(newPayment(session, { amount_minor: 500000, currency: 'CRC' }));
    await repos.payment.create(newPayment(session, { amount_minor: 2000, currency: 'USD' }));
    const refunded = await repos.payment.create(newPayment(session, { amount_minor: 99 }));
    await repos.payment.remove(refunded.id);
    const { session: other } = await createSession(db, client.id);
    await repos.payment.create(newPayment(other));

    expect(await getSessionDeletionSummary(db, session.id)).toEqual({
      readings: 1,
      payments: 3,
      paidByCurrency: { CRC: 1500000, USD: 2000 },
    });
  });
});

describe('deleteSession', () => {
  it('tombstones the session and its payments, readings and card draws, nothing else', async () => {
    const client = await repos.client.create(newClient());
    const { session } = await createSession(db, client.id);
    const { reading, draw } = await addReading(session);
    const payment = await repos.payment.create(newPayment(session));
    const { session: other } = await createSession(db, client.id);
    const otherPayment = await repos.payment.create(newPayment(other));

    await deleteSession(db, session.id, clock);

    for (const row of [
      await db.session.get(session.id),
      await db.payment.get(payment.id),
      await db.reading.get(reading.id),
      await db.card_draw.get(draw.id),
    ]) {
      expect(row).toMatchObject({ deleted_at: NOW, updated_at: NOW, pending: 1 });
    }
    expect(await repos.session.get(other.id)).toBeDefined();
    expect(await repos.payment.get(otherPayment.id)).toBeDefined();
    expect(await repos.client.get(client.id)).toBeDefined();
  });
});

describe('discardIfUntouched', () => {
  async function created(archived = false) {
    const client = await repos.client.create(newClient({ archived }));
    const result = await createSession(db, client.id);
    return { client, ...result, fields: pickSessionFields(result.session) };
  }

  it('tombstones a session left exactly as created', async () => {
    const { session, fields } = await created();

    expect(await discardIfUntouched(db, session.id, fields, { clock })).toBe(true);
    expect(await db.session.get(session.id)).toMatchObject({ deleted_at: NOW, pending: 1 });
  });

  it('keeps a session with any edited field', async () => {
    for (const patch of [
      { notes: 'Ansiedad por el trabajo' },
      { type: 'online' as const },
      { price_minor: 1500000 },
      { currency: 'USD' as const },
      { started_at: '2026-10-18T15:00:00.000Z' },
      { follow_up_note: 'Revisar en 1 mes' },
      { follow_up_date: '2026-11-19' },
    ]) {
      const { session, fields } = await created();
      await repos.session.update(session.id, patch);

      expect(await discardIfUntouched(db, session.id, fields), JSON.stringify(patch)).toBe(false);
      expect(await repos.session.get(session.id)).toBeDefined();
    }
  });

  it('discards a session whose edits were all undone', async () => {
    const { session, fields } = await created();
    await repos.session.update(session.id, { notes: 'x' });
    await repos.session.update(session.id, { notes: '' });

    expect(await discardIfUntouched(db, session.id, fields)).toBe(true);
  });

  it('keeps a session with a reading or a payment', async () => {
    const withReading = await created();
    await addReading(withReading.session);
    const withPayment = await created();
    await repos.payment.create(newPayment(withPayment.session));

    expect(await discardIfUntouched(db, withReading.session.id, withReading.fields)).toBe(false);
    expect(await discardIfUntouched(db, withPayment.session.id, withPayment.fields)).toBe(false);
  });

  it('archives the client again when creating the session had unarchived them', async () => {
    const { client, session, fields, unarchived } = await created(true);
    expect(unarchived).toBe(true);

    await discardIfUntouched(db, session.id, fields, { rearchiveClient: true });

    expect((await repos.client.get(client.id))?.archived).toBe(true);
  });

  it('is a no-op for a session that is already gone', async () => {
    const { session, fields } = await created();
    await deleteSession(db, session.id);

    expect(await discardIfUntouched(db, session.id, fields)).toBe(false);
  });
});
