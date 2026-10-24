import { v7 as uuidv7 } from 'uuid';

import { db, repos } from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { clearDb, newClient, newPayment, newSession } from '../clients/test-utils';
import { dataSummary, uuidv7Date } from './dataCheck';

beforeEach(async () => {
  await clearDb();
});

const DEVICE_ID = '019a0c3e-4c00-7abc-8def-0123456789ab';
// 0x019a0c3e4c00 ms since the epoch.
const DEVICE_TIME = '2025-10-22T14:06:40.640Z';

describe('uuidv7Date', () => {
  it('decodes the creation time from a UUIDv7', () => {
    expect(uuidv7Date(DEVICE_ID)?.toISOString()).toBe(DEVICE_TIME);
  });

  it('round-trips the time given to the uuid library', () => {
    const msecs = Date.parse('2026-10-14T08:30:00.000Z');
    expect(uuidv7Date(uuidv7({ msecs }))?.getTime()).toBe(msecs);
  });

  it('returns null for anything that is not a UUIDv7', () => {
    expect(uuidv7Date('9b2f2c1e-6a4d-4f3b-8e2a-1c5d7f9a0b3c')).toBeNull();
    expect(uuidv7Date('d1')).toBeNull();
  });
});

describe('dataSummary', () => {
  it('counts live records only, leaving out tombstones and untouched seed rows', async () => {
    await loadSeed(db);
    // getDeviceId caches per db, so after clearDb() set the id ourselves.
    await db.meta.put({ key: 'device_id', value: DEVICE_ID });
    const client = await repos.client.create(newClient({ created_at: '2026-09-01T12:00:00.000Z' }));
    const gone = await repos.client.create(newClient({ created_at: '2026-01-01T12:00:00.000Z' }));
    await repos.client.create(newClient({ created_at: '2026-10-05T12:00:00.000Z' }));
    await repos.client.remove(gone.id);

    const session = await repos.session.create(
      newSession(client.id, { started_at: '2026-09-02T15:00:00.000Z' }),
    );
    const oldGone = await repos.session.create(
      newSession(client.id, { started_at: '2026-02-01T15:00:00.000Z' }),
    );
    await repos.session.remove(oldGone.id);
    await repos.payment.create(newPayment(session));

    const reading = await repos.reading.create({
      session_id: session.id,
      spread_template_id: seedId('spread_template', 'x'),
      spread_snapshot: { name: 'Tirada de prueba', positions: [] },
      label: null,
      created_at: session.started_at,
    });
    for (const card_id of ['major-00', 'cups-07']) {
      await repos.card_draw.create({
        reading_id: reading.id,
        position_index: 1,
        card_id,
        reversed: false,
        note: '',
      });
    }
    const note = await repos.card_note.create({ card_id: 'major-00', note: 'Nota de prueba' });
    await repos.card_note.create({ card_id: 'major-01', note: 'Otra nota de prueba' });
    await repos.card_note.remove(note.id);

    await repos.spread_template.create({
      name: 'Tirada propia de prueba',
      description: '',
      positions: [],
      is_seed: false,
      seed_key: null,
    });
    const [edited, hidden] = await db.crystal.limit(2).toArray();
    if (!edited || !hidden) throw new Error('seed has fewer than two crystals');
    await repos.crystal.update(edited.id, { user_modified: true });
    // Hiding alone doesn't make a seed crystal hers.
    await repos.crystal.update(hidden.id, { hidden: true });
    await repos.crystal.create({
      seed_key: null,
      name: 'Cristal de prueba',
      colors: [],
      chakras: [],
      signs: [],
      intentions: [],
      description: '',
      care: '',
      hidden: false,
      user_modified: false,
    });

    const summary = await dataSummary(db);
    expect(summary.counts).toEqual({
      clients: 2,
      sessions: 1,
      payments: 1,
      readings: 1,
      cardDraws: 2,
      cardNotes: 1,
      ownSpreads: 1,
      ownCrystals: 2,
    });
    expect(summary.oldestClientCreatedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(summary.oldestSessionStartedAt).toBe('2026-09-02T15:00:00.000Z');

    expect(summary.phone).toEqual({ short: '019a0c3e', since: new Date(DEVICE_TIME) });
  });

  it('reports a missing device id and an empty database without writing anything', async () => {
    const summary = await dataSummary(db);
    expect(summary).toEqual({
      phone: null,
      counts: {
        clients: 0,
        sessions: 0,
        payments: 0,
        readings: 0,
        cardDraws: 0,
        cardNotes: 0,
        ownSpreads: 0,
        ownCrystals: 0,
      },
      oldestClientCreatedAt: null,
      oldestSessionStartedAt: null,
    });
    expect(await db.meta.count()).toBe(0);
  });
});
