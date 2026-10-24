import { db, repos } from '../../db';
import { loadSeed, seedId } from '../../seed/loader';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { attachCrystal, detachCrystal, sessionCrystalId } from './actions';
import { getSessionCrystals } from './hooks';

// Later than the real clock that stamps rows made through `repos` (updated_at only moves forward).
const at = (minute: number) => () => `2099-10-19T15:${String(minute).padStart(2, '0')}:00.000Z`;

const ROSE = seedId('crystal', 'rose-quartz');
const AMETHYST = seedId('crystal', 'amethyst');

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

async function liveSession() {
  const client = await repos.client.create(newClient());
  return repos.session.create(newSession(client.id));
}

describe('sessionCrystalId', () => {
  it('is the same for the same pair on every device, and differs per pair', () => {
    expect(sessionCrystalId('s1', ROSE)).toBe(sessionCrystalId('s1', ROSE));
    expect(sessionCrystalId('s1', ROSE)).not.toBe(sessionCrystalId('s1', AMETHYST));
    expect(sessionCrystalId('s1', ROSE)).not.toBe(sessionCrystalId('s2', ROSE));
  });
});

describe('attachCrystal / detachCrystal', () => {
  it('attaches a crystal as a pending row with the pair id', async () => {
    const session = await liveSession();

    await attachCrystal(db, session.id, ROSE, at(1));

    expect(await db.session_crystal.toArray()).toEqual([
      expect.objectContaining({
        id: sessionCrystalId(session.id, ROSE),
        session_id: session.id,
        crystal_id: ROSE,
        deleted_at: null,
        updated_at: at(1)(),
        server_version: null,
        pending: 1,
      }),
    ]);
  });

  it('leaves a crystal already attached as it is', async () => {
    const session = await liveSession();
    await attachCrystal(db, session.id, ROSE, at(1));
    await db.session_crystal.toCollection().modify({ pending: 0 });

    await attachCrystal(db, session.id, ROSE, at(2));

    expect(await db.session_crystal.toArray()).toEqual([
      expect.objectContaining({ updated_at: at(1)(), pending: 0 }),
    ]);
  });

  it('removing tombstones the row; attaching again revives the same row', async () => {
    const session = await liveSession();
    await attachCrystal(db, session.id, ROSE, at(1));
    // As if synced.
    await db.session_crystal.toCollection().modify({ pending: 0, server_version: 9 });

    await detachCrystal(db, session.id, ROSE, at(2));
    expect(await db.session_crystal.toArray()).toEqual([
      expect.objectContaining({ deleted_at: at(2)(), updated_at: at(2)(), pending: 1 }),
    ]);

    await attachCrystal(db, session.id, ROSE, at(3));
    expect(await db.session_crystal.toArray()).toEqual([
      expect.objectContaining({
        id: sessionCrystalId(session.id, ROSE),
        deleted_at: null,
        updated_at: at(3)(),
        server_version: 9,
        pending: 1,
      }),
    ]);
  });

  it('removing a crystal that is not attached does nothing', async () => {
    const session = await liveSession();

    await detachCrystal(db, session.id, ROSE, at(1));

    expect(await db.session_crystal.count()).toBe(0);
  });

  it('refuses a deleted session or a crystal that does not exist', async () => {
    const session = await liveSession();
    await expect(attachCrystal(db, session.id, 'no-such-crystal')).rejects.toThrow(/crystal/);
    await repos.session.remove(session.id);
    await expect(attachCrystal(db, session.id, ROSE)).rejects.toThrow(/session/);
    expect(await db.session_crystal.count()).toBe(0);
  });
});

describe('getSessionCrystals', () => {
  it('lists the attached crystals in the order she attached them', async () => {
    const session = await liveSession();
    await attachCrystal(db, session.id, ROSE, at(1));
    await attachCrystal(db, session.id, AMETHYST, at(2));
    await attachCrystal(db, session.id, seedId('crystal', 'citrine'), at(3));
    await detachCrystal(db, session.id, seedId('crystal', 'citrine'), at(4));
    await attachCrystal(db, (await liveSession()).id, ROSE, at(5));

    const names = (await getSessionCrystals(db, session.id)).map(({ crystal }) => crystal.name);
    expect(names).toEqual(['Cuarzo rosa', 'Amatista']);
  });

  it('keeps hidden and deleted crystals, with their rows', async () => {
    const session = await liveSession();
    await attachCrystal(db, session.id, ROSE, at(1));
    await attachCrystal(db, session.id, AMETHYST, at(2));
    await repos.crystal.update(ROSE, { hidden: true });
    await repos.crystal.remove(AMETHYST);

    const attached = await getSessionCrystals(db, session.id);
    expect(attached.map(({ crystal }) => [crystal.id, crystal.hidden, crystal.deleted_at])).toEqual(
      [
        [ROSE, true, null],
        [AMETHYST, false, expect.any(String)],
      ],
    );
  });

  it('hides the attachments of a deleted session', async () => {
    const session = await liveSession();
    await attachCrystal(db, session.id, ROSE, at(1));
    // Deleted on another device without its attachments (e.g. an attach pushed afterwards).
    await db.session.update(session.id, { deleted_at: at(2)() });

    expect(await getSessionCrystals(db, session.id)).toEqual([]);
  });

  it('leaves out an attachment whose crystal row is not on this device yet', async () => {
    const session = await liveSession();
    await db.session_crystal.put({
      id: sessionCrystalId(session.id, 'from-a-newer-seed'),
      session_id: session.id,
      crystal_id: 'from-a-newer-seed',
      updated_at: at(1)(),
      deleted_at: null,
      server_version: 3,
      device_id: 'other-device',
      pending: 0,
    });

    expect(await getSessionCrystals(db, session.id)).toEqual([]);
    expect(await db.session_crystal.count()).toBe(1);
  });
});
