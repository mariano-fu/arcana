import { db, repos, type Session } from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';
import { attachCrystal, detachCrystal, sessionCrystalId } from '../crystals/actions';
import {
  createSession,
  deleteSession,
  discardIfUntouched,
  getSessionDeletionSummary,
  sweepFreshSessions,
} from './actions';
import { defaultSessionFields, pickSessionFields } from './form';

// Later than the real clock that stamps rows made through `repos`: updated_at only moves
// forward (db/monotonic.ts), so an earlier fixed clock would be bumped past those rows.
const NOW = '2099-10-19T15:00:00.000Z';
const clock = () => NOW;

const ROSE = seedId('crystal', 'rose-quartz');
const AMETHYST = seedId('crystal', 'amethyst');

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

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
  it('counts live readings, payments and attached crystals, with totals per currency', async () => {
    const client = await repos.client.create(newClient());
    const { session } = await createSession(db, client.id);
    await addReading(session);
    await repos.payment.create(newPayment(session, { amount_minor: 1000000, currency: 'CRC' }));
    await repos.payment.create(newPayment(session, { amount_minor: 500000, currency: 'CRC' }));
    await repos.payment.create(newPayment(session, { amount_minor: 2000, currency: 'USD' }));
    const refunded = await repos.payment.create(newPayment(session, { amount_minor: 99 }));
    await repos.payment.remove(refunded.id);
    await attachCrystal(db, session.id, ROSE);
    await attachCrystal(db, session.id, AMETHYST);
    await detachCrystal(db, session.id, AMETHYST);
    const { session: other } = await createSession(db, client.id);
    await repos.payment.create(newPayment(other));
    await attachCrystal(db, other.id, AMETHYST);

    expect(await getSessionDeletionSummary(db, session.id)).toEqual({
      readings: 1,
      payments: 3,
      crystals: 1,
      paidByCurrency: { CRC: 1500000, USD: 2000 },
    });
  });
});

describe('deleteSession', () => {
  it('tombstones the session and its payments, readings, draws and crystals, nothing else', async () => {
    const client = await repos.client.create(newClient());
    const { session } = await createSession(db, client.id);
    const { reading, draw } = await addReading(session);
    const payment = await repos.payment.create(newPayment(session));
    const attached = await attachCrystal(db, session.id, ROSE);
    const { session: other } = await createSession(db, client.id);
    const otherPayment = await repos.payment.create(newPayment(other));
    const otherAttached = await attachCrystal(db, other.id, ROSE);

    await deleteSession(db, session.id, clock);

    for (const row of [
      await db.session.get(session.id),
      await db.payment.get(payment.id),
      await db.reading.get(reading.id),
      await db.card_draw.get(draw.id),
      await db.session_crystal.get(attached.id),
    ]) {
      expect(row).toMatchObject({ deleted_at: NOW, updated_at: NOW, pending: 1 });
    }
    expect(await repos.session.get(other.id)).toBeDefined();
    expect(await repos.payment.get(otherPayment.id)).toBeDefined();
    expect(await repos.session_crystal.get(otherAttached.id)).toBeDefined();
    expect(await repos.client.get(client.id)).toBeDefined();
  });
});

describe('discardIfUntouched', () => {
  async function created(archived = false) {
    const client = await repos.client.create(newClient({ archived }));
    return { client, ...(await createSession(db, client.id)) };
  }

  it('tombstones a session left exactly as created, and drops its marker', async () => {
    const { session } = await created();

    expect(await discardIfUntouched(db, session.id, { clock })).toBe(true);
    expect(await db.session.get(session.id)).toMatchObject({ deleted_at: NOW, pending: 1 });
    expect(await db.meta.where('key').startsWith('fresh_session:').count()).toBe(0);
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
      const { session } = await created();
      await repos.session.update(session.id, patch);

      expect(await discardIfUntouched(db, session.id), JSON.stringify(patch)).toBe(false);
      expect(await repos.session.get(session.id)).toBeDefined();
    }
  });

  it('discards a session whose edits were all undone, unless asked for unmodified', async () => {
    const undone = await created();
    const strict = await created();
    for (const { session } of [undone, strict]) {
      await repos.session.update(session.id, { notes: 'x' });
      await repos.session.update(session.id, { notes: '' });
    }

    expect(await discardIfUntouched(db, undone.session.id)).toBe(true);
    expect(await discardIfUntouched(db, strict.session.id, { requireUnmodified: true })).toBe(
      false,
    );
  });

  it('keeps a session with a reading or a payment', async () => {
    const withReading = await created();
    await addReading(withReading.session);
    const withPayment = await created();
    await repos.payment.create(newPayment(withPayment.session));

    expect(await discardIfUntouched(db, withReading.session.id)).toBe(false);
    expect(await discardIfUntouched(db, withPayment.session.id)).toBe(false);
  });

  it('keeps a session with an attached crystal', async () => {
    const { session } = await created();
    await attachCrystal(db, session.id, ROSE);

    expect(await discardIfUntouched(db, session.id)).toBe(false);
    expect(await repos.session.get(session.id)).toBeDefined();
    expect(await repos.session_crystal.get(sessionCrystalId(session.id, ROSE))).toBeDefined();
  });

  it('discards a session whose crystal was attached and removed again (T2.9 Q3)', async () => {
    const leaving = await created();
    const sweeping = await created();
    for (const { session } of [leaving, sweeping]) {
      await attachCrystal(db, session.id, ROSE);
      await detachCrystal(db, session.id, ROSE);
    }

    expect(await discardIfUntouched(db, leaving.session.id)).toBe(true);
    // The startup sweep too: the session row itself was never modified.
    expect(await discardIfUntouched(db, sweeping.session.id, { requireUnmodified: true })).toBe(
      true,
    );
  });

  it('archives the client again when creating the session had unarchived them', async () => {
    const { client, session, unarchived } = await created(true);
    expect(unarchived).toBe(true);

    await discardIfUntouched(db, session.id);

    expect((await repos.client.get(client.id))?.archived).toBe(true);
  });

  it('only acts once: the first check removes the marker, kept or not', async () => {
    const { session } = await created();
    await repos.session.update(session.id, { notes: 'x' });
    expect(await discardIfUntouched(db, session.id)).toBe(false);

    await repos.session.update(session.id, { notes: '' });
    expect(await discardIfUntouched(db, session.id)).toBe(false);
    expect(await repos.session.get(session.id)).toBeDefined();
  });

  it('never touches a session without a marker (e.g. one synced from another device)', async () => {
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));

    expect(await discardIfUntouched(db, session.id)).toBe(false);
    expect(await repos.session.get(session.id)).toBeDefined();
  });

  it('ignores a corrupt marker', async () => {
    const { session } = await created();
    await db.meta.put({ key: `fresh_session:${session.id}`, value: '{not json' });

    expect(await discardIfUntouched(db, session.id)).toBe(false);
    expect(await repos.session.get(session.id)).toBeDefined();
  });

  it('deleteSession drops the marker', async () => {
    const { session } = await created();
    await deleteSession(db, session.id);

    expect(await db.meta.get(`fresh_session:${session.id}`)).toBeUndefined();
    expect(await discardIfUntouched(db, session.id)).toBe(false);
  });
});

describe('sweepFreshSessions', () => {
  it('discards sessions left in their just-created state when the app was closed', async () => {
    const archived = await repos.client.create(newClient({ archived: true }));
    const { session: fresh } = await createSession(db, archived.id);
    const active = await repos.client.create(newClient());
    const { session: edited } = await createSession(db, active.id);
    await repos.session.update(edited.id, { notes: 'Tres de Espadas' });
    const { session: paid } = await createSession(db, active.id);
    await repos.payment.create(newPayment(paid));
    const { session: withCrystal } = await createSession(db, active.id);
    await attachCrystal(db, withCrystal.id, ROSE);
    const { session: open } = await createSession(db, active.id);
    const old = await repos.session.create(newSession(active.id));

    expect(await sweepFreshSessions(db, { except: open.id, clock })).toBe(1);

    expect(await db.session.get(fresh.id)).toMatchObject({ deleted_at: NOW });
    expect((await repos.client.get(archived.id))?.archived).toBe(true);
    for (const kept of [edited, paid, withCrystal, open, old]) {
      expect(await repos.session.get(kept.id)).toBeDefined();
    }
    // The open page's session keeps its marker for when she leaves it.
    expect(await db.meta.where('key').startsWith('fresh_session:').primaryKeys()).toEqual([
      `fresh_session:${open.id}`,
    ]);
  });
});
