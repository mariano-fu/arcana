import { db, repos } from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { attachCrystal, detachCrystal } from '../crystals/actions';
import { deleteClient, getDeletionSummary } from './deletion';
import { clearDb, newClient, newPayment, newSession, seedClientWithHistory } from './test-utils';

const ROSE = seedId('crystal', 'rose-quartz');
const AMETHYST = seedId('crystal', 'amethyst');

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

describe('getDeletionSummary', () => {
  it('counts live sessions, payments and crystals in them, with totals per currency', async () => {
    const client = await seedClientWithHistory('Ana', 4, [
      { amount_minor: 2000000, currency: 'CRC' },
      { amount_minor: 2500000, currency: 'CRC' },
      { amount_minor: 2000, currency: 'USD' },
    ]);
    // Tombstones and other clients' rows don't count.
    const gone = await repos.session.create(newSession(client.id));
    const refunded = await repos.payment.create(newPayment(gone, { amount_minor: 999 }));
    await repos.payment.remove(refunded.id);
    await attachCrystal(db, gone.id, ROSE);
    await repos.session.remove(gone.id);
    const [first, second] = await repos.session.list();
    if (!first || !second) throw new Error('sessions missing');
    await attachCrystal(db, first.id, ROSE);
    await attachCrystal(db, first.id, AMETHYST);
    await attachCrystal(db, second.id, ROSE);
    await detachCrystal(db, second.id, ROSE);
    const otra = await seedClientWithHistory('Otra', 2, [{ amount_minor: 100 }]);
    const [otraSession] = (await repos.session.list()).filter((s) => s.client_id === otra.id);
    if (!otraSession) throw new Error('session missing');
    await attachCrystal(db, otraSession.id, ROSE);

    expect(await getDeletionSummary(db, client.id)).toEqual({
      sessions: 4,
      payments: 3,
      crystals: 2,
      paidByCurrency: { CRC: 4500000, USD: 2000 },
    });
  });

  it('is empty for a client without history', async () => {
    const client = await repos.client.create(newClient());
    expect(await getDeletionSummary(db, client.id)).toEqual({
      sessions: 0,
      payments: 0,
      crystals: 0,
      paidByCurrency: {},
    });
  });
});

describe('deleteClient', () => {
  it('tombstones the client and its sessions, payments, readings, draws and crystals', async () => {
    const client = await repos.client.create(newClient());
    const session = await repos.session.create(newSession(client.id));
    const payment = await repos.payment.create(newPayment(session));
    const reading = await repos.reading.create({
      session_id: session.id,
      spread_template_id: 'template',
      spread_snapshot: { name: '1 carta', positions: [] },
      label: null,
      created_at: '2026-10-10T15:00:00.000Z',
    });
    const draw = await repos.card_draw.create({
      reading_id: reading.id,
      position_index: 1,
      card_id: 'major-00',
      reversed: false,
      note: '',
    });
    const attached = await attachCrystal(db, session.id, ROSE);
    const other = await seedClientWithHistory('Otra', 1, [{}]);
    const [otherSession] = (await repos.session.list()).filter((s) => s.client_id === other.id);
    if (!otherSession) throw new Error('session missing');
    const otherAttached = await attachCrystal(db, otherSession.id, ROSE);
    await db.table('client').toCollection().modify({ pending: 0 });

    // Later than the real clock that created the rows: updated_at only moves forward.
    await deleteClient(db, client.id, () => '2099-10-19T00:00:00.000Z');

    for (const [table, id] of [
      ['client', client.id],
      ['session', session.id],
      ['payment', payment.id],
      ['reading', reading.id],
      ['card_draw', draw.id],
      ['session_crystal', attached.id],
    ] as const) {
      const row: unknown = await db.table(table).get(id);
      expect(row).toMatchObject({ deleted_at: '2099-10-19T00:00:00.000Z', pending: 1 });
    }
    expect(await repos.client.get(other.id)).toBeDefined();
    expect(await repos.session.list()).toHaveLength(1);
    expect(await repos.payment.list()).toHaveLength(1);
    expect(await repos.session_crystal.get(otherAttached.id)).toBeDefined();
  });
});
