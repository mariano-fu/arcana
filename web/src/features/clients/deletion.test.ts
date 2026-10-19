import { db, repos } from '../../db';
import { deleteClient, getDeletionSummary } from './deletion';
import { clearDb, newClient, newPayment, newSession, seedClientWithHistory } from './test-utils';

beforeEach(clearDb);

describe('getDeletionSummary', () => {
  it('counts live sessions and payments, with totals per currency', async () => {
    const client = await seedClientWithHistory('Ana', 4, [
      { amount_minor: 2000000, currency: 'CRC' },
      { amount_minor: 2500000, currency: 'CRC' },
      { amount_minor: 2000, currency: 'USD' },
    ]);
    // Tombstones and other clients' rows don't count.
    const gone = await repos.session.create(newSession(client.id));
    const refunded = await repos.payment.create(newPayment(gone, { amount_minor: 999 }));
    await repos.payment.remove(refunded.id);
    await repos.session.remove(gone.id);
    await seedClientWithHistory('Otra', 2, [{ amount_minor: 100 }]);

    expect(await getDeletionSummary(db, client.id)).toEqual({
      sessions: 4,
      payments: 3,
      paidByCurrency: { CRC: 4500000, USD: 2000 },
    });
  });

  it('is empty for a client without history', async () => {
    const client = await repos.client.create(newClient());
    expect(await getDeletionSummary(db, client.id)).toEqual({
      sessions: 0,
      payments: 0,
      paidByCurrency: {},
    });
  });
});

describe('deleteClient', () => {
  it('tombstones the client and its sessions, payments, readings and card draws', async () => {
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
    const other = await seedClientWithHistory('Otra', 1, [{}]);
    await db.table('client').toCollection().modify({ pending: 0 });

    await deleteClient(db, client.id, () => '2026-10-19T00:00:00.000Z');

    for (const [table, id] of [
      ['client', client.id],
      ['session', session.id],
      ['payment', payment.id],
      ['reading', reading.id],
      ['card_draw', draw.id],
    ] as const) {
      const row: unknown = await db.table(table).get(id);
      expect(row).toMatchObject({ deleted_at: '2026-10-19T00:00:00.000Z', pending: 1 });
    }
    expect(await repos.client.get(other.id)).toBeDefined();
    expect(await repos.session.list()).toHaveLength(1);
    expect(await repos.payment.list()).toHaveLength(1);
  });
});
