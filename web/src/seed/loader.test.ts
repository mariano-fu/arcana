import { ArcanaDB, createRepositories, getDeviceId, type Repositories } from '../db';
import { bundledSeed, loadSeed, SEED_VERSION_KEYS, seedId, type SeedBundle } from './loader';

/** A clock that advances one second per call, so every write gets a distinct timestamp. */
function fakeClock(start = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(start);
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}

/** A deep copy of the bundled seed, safe to edit per test. */
const cloneBundle = (): SeedBundle => structuredClone(bundledSeed);

/** The bundled seed with both versions bumped and `edit` applied. */
function nextBundle(edit: (bundle: SeedBundle) => void = () => undefined): SeedBundle {
  const bundle = cloneBundle();
  bundle.spreads.version += 1;
  bundle.crystals.version += 1;
  edit(bundle);
  return bundle;
}

function seedCrystal(bundle: SeedBundle, key: string) {
  const crystal = bundle.crystals.crystals.find((c) => c.key === key);
  if (!crystal) throw new Error(`${key} missing from seed`);
  return crystal;
}

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: ArcanaDB;
let repos: Repositories;
let clock: () => string;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  clock = fakeClock();
  repos = createRepositories(db, clock);
});

afterEach(async () => {
  await db.delete();
});

describe('seedId', () => {
  it('is a UUIDv5 that depends only on table and key', () => {
    const id = seedId('crystal', 'amethyst');

    expect(id).toMatch(UUID_V5);
    expect(seedId('crystal', 'amethyst')).toBe(id);
    expect(seedId('crystal', 'rose-quartz')).not.toBe(id);
    expect(seedId('intention_tag', 'amethyst')).not.toBe(id);
  });
});

describe('first load', () => {
  it('inserts every seed row with its seed id, unsynced and not pending', async () => {
    await loadSeed(db, bundledSeed, clock);
    const deviceId = await getDeviceId(db);

    const spreads = await db.spread_template.toArray();
    expect(spreads.map((s) => s.seed_key).sort()).toEqual(
      bundledSeed.spreads.spreads.map((s) => s.key).sort(),
    );
    for (const spread of spreads) {
      expect(spread.id).toBe(seedId('spread_template', spread.seed_key ?? ''));
      expect(spread).toMatchObject({
        is_seed: true,
        pending: 0,
        server_version: null,
        deleted_at: null,
        device_id: deviceId,
      });
    }

    const crystals = await db.crystal.toArray();
    expect(crystals).toHaveLength(bundledSeed.crystals.crystals.length);
    const amethyst = await db.crystal.get(seedId('crystal', 'amethyst'));
    const seedAmethyst = bundledSeed.crystals.crystals.find((c) => c.key === 'amethyst');
    if (!seedAmethyst) throw new Error('amethyst missing from seed');
    const { key, ...content } = seedAmethyst;
    expect(amethyst).toMatchObject({
      ...content,
      seed_key: key,
      hidden: false,
      user_modified: false,
      pending: 0,
    });

    const tags = await db.intention_tag.toArray();
    expect(tags.map((t) => t.key).sort()).toEqual([...bundledSeed.intentions].sort());
    for (const tag of tags) {
      expect(tag).toMatchObject({ id: seedId('intention_tag', tag.key), label: null, pending: 0 });
    }

    expect(await db.meta.get(SEED_VERSION_KEYS.spreads)).toEqual({
      key: SEED_VERSION_KEYS.spreads,
      value: String(bundledSeed.spreads.version),
    });
    expect(await db.meta.get(SEED_VERSION_KEYS.crystals)).toEqual({
      key: SEED_VERSION_KEYS.crystals,
      value: String(bundledSeed.crystals.version),
    });
  });

  it('creates the same ids in two separate databases', async () => {
    const other = new ArcanaDB(`test-${crypto.randomUUID()}`);
    await Promise.all([loadSeed(db), loadSeed(other)]);

    const ids = async (d: ArcanaDB) =>
      [
        ...(await d.spread_template.toCollection().primaryKeys()),
        ...(await d.crystal.toCollection().primaryKeys()),
        ...(await d.intention_tag.toCollection().primaryKeys()),
      ].sort();
    expect(await ids(other)).toEqual(await ids(db));
    await other.delete();
  });

  it('is safe to run concurrently', async () => {
    await Promise.all([loadSeed(db), loadSeed(db)]);

    expect(await db.crystal.count()).toBe(bundledSeed.crystals.crystals.length);
    expect(await db.intention_tag.count()).toBe(bundledSeed.intentions.length);
  });
});

describe('same version', () => {
  it('writes nothing', async () => {
    await loadSeed(db, bundledSeed, clock);
    const before = await db.crystal.toArray();
    const spreadsBefore = await db.spread_template.toArray();

    // Even a changed text is ignored while the version stays the same.
    const bundle = cloneBundle();
    seedCrystal(bundle, 'amethyst').name = 'Otro nombre';
    await loadSeed(db, bundle, clock);

    expect(await db.crystal.toArray()).toEqual(before);
    expect(await db.spread_template.toArray()).toEqual(spreadsBefore);
  });
});

describe('crystals on a version bump', () => {
  beforeEach(async () => {
    await loadSeed(db, bundledSeed, clock);
  });

  const amethystId = seedId('crystal', 'amethyst');
  const roseId = seedId('crystal', 'rose-quartz');

  it('updates seed content of rows she has not modified', async () => {
    await loadSeed(
      db,
      nextBundle((b) => {
        const amethyst = b.crystals.crystals.find((c) => c.key === 'amethyst');
        if (amethyst) amethyst.description = 'Descripción nueva.';
      }),
      clock,
    );

    expect((await db.crystal.get(amethystId))?.description).toBe('Descripción nueva.');
  });

  it('never overwrites a row she modified', async () => {
    const edited = await repos.crystal.update(amethystId, {
      description: 'Su propia descripción.',
      user_modified: true,
    });

    await loadSeed(
      db,
      nextBundle((b) => {
        const amethyst = b.crystals.crystals.find((c) => c.key === 'amethyst');
        if (amethyst) amethyst.description = 'Descripción nueva.';
      }),
      clock,
    );

    expect(await db.crystal.get(amethystId)).toEqual(edited);
  });

  it('keeps hidden and an unsynced pending change on rows it updates', async () => {
    await repos.crystal.update(roseId, { hidden: true });

    await loadSeed(db, nextBundle(), clock);

    expect(await db.crystal.get(roseId)).toMatchObject({ hidden: true, pending: 1 });
  });

  it('keeps server_version on rows that came through sync', async () => {
    await db.crystal.update(roseId, { server_version: 42 });

    await loadSeed(db, nextBundle(), clock);

    expect((await db.crystal.get(roseId))?.server_version).toBe(42);
  });

  it('does not bring back a row she deleted', async () => {
    await repos.crystal.remove(amethystId);
    const tombstone = await db.crystal.get(amethystId);

    await loadSeed(db, nextBundle(), clock);

    expect(await db.crystal.get(amethystId)).toEqual(tombstone);
  });

  it('inserts new seed crystals and keeps ones dropped from the seed', async () => {
    await loadSeed(
      db,
      nextBundle((b) => {
        const template = seedCrystal(b, 'rose-quartz');
        b.crystals.crystals = b.crystals.crystals.filter((c) => c.key !== 'amethyst');
        b.crystals.crystals.push({ ...template, key: 'new-stone', name: 'Piedra nueva' });
      }),
      clock,
    );

    expect(await db.crystal.get(seedId('crystal', 'new-stone'))).toMatchObject({
      name: 'Piedra nueva',
      pending: 0,
    });
    expect(await repos.crystal.get(amethystId)).toBeDefined();
  });

  it('never touches crystals she created', async () => {
    const mine = await repos.crystal.create({
      seed_key: null,
      name: 'Mi cristal',
      colors: ['green'],
      chakras: ['heart'],
      signs: [],
      intentions: ['calm'],
      description: '',
      care: '',
      hidden: false,
      user_modified: false,
    });

    await loadSeed(db, nextBundle(), clock);

    expect(await db.crystal.get(mine.id)).toEqual(mine);
  });
});

describe('spreads on a version bump', () => {
  beforeEach(async () => {
    await loadSeed(db, bundledSeed, clock);
  });

  const celticId = seedId('spread_template', 'celtic-cross');

  it('always overwrites seed spreads with the bundled version', async () => {
    await db.spread_template.update(celticId, { name: 'Cambiado' });

    await loadSeed(
      db,
      nextBundle((b) => {
        const celtic = b.spreads.spreads.find((s) => s.key === 'celtic-cross');
        if (celtic) celtic.description = 'Descripción nueva.';
      }),
      clock,
    );

    const celtic = await db.spread_template.get(celticId);
    const seed = bundledSeed.spreads.spreads.find((s) => s.key === 'celtic-cross');
    expect(celtic).toMatchObject({
      name: seed?.name,
      description: 'Descripción nueva.',
      positions: seed?.positions,
    });
  });

  it('never touches custom spreads, including copies of a seed spread', async () => {
    const seedCeltic = await db.spread_template.get(celticId);
    if (!seedCeltic) throw new Error('seed spread missing');
    const copy = await repos.spread_template.create({
      name: 'Mi Cruz Celta',
      description: seedCeltic.description,
      positions: seedCeltic.positions,
      is_seed: false,
      seed_key: null,
    });

    await loadSeed(
      db,
      nextBundle((b) => {
        const celtic = b.spreads.spreads.find((s) => s.key === 'celtic-cross');
        if (celtic) celtic.description = 'Descripción nueva.';
      }),
      clock,
    );

    expect(await db.spread_template.get(copy.id)).toEqual(copy);
  });

  it('does not bring back a deleted seed spread, and keeps ones dropped from the seed', async () => {
    const oneCardId = seedId('spread_template', 'one-card');
    await repos.spread_template.remove(celticId);

    await loadSeed(
      db,
      nextBundle((b) => {
        b.spreads.spreads = b.spreads.spreads.filter((s) => s.key !== 'one-card');
      }),
      clock,
    );

    expect((await db.spread_template.get(celticId))?.deleted_at).not.toBeNull();
    expect(await repos.spread_template.get(oneCardId)).toBeDefined();
  });

  it('is versioned separately from crystals', async () => {
    const before = await db.spread_template.toArray();
    const bundle = cloneBundle();
    bundle.crystals.version += 1;

    await loadSeed(db, bundle, clock);

    expect(await db.spread_template.toArray()).toEqual(before);
  });
});

describe('intention tags on a crystals version bump', () => {
  beforeEach(async () => {
    await loadSeed(db, bundledSeed, clock);
  });

  it('adds new seed tags', async () => {
    await loadSeed(
      db,
      nextBundle((b) => {
        b.intentions = [...b.intentions, 'gratitude'];
      }),
      clock,
    );

    expect(await db.intention_tag.get(seedId('intention_tag', 'gratitude'))).toMatchObject({
      key: 'gratitude',
      label: null,
    });
  });

  it('keeps a seed tag she renamed, and one she deleted stays deleted', async () => {
    const renamed = await repos.intention_tag.update(seedId('intention_tag', 'calm'), {
      label: 'Paz',
    });
    await repos.intention_tag.remove(seedId('intention_tag', 'rest'));

    await loadSeed(db, nextBundle(), clock);

    expect(await db.intention_tag.get(renamed.id)).toEqual(renamed);
    expect(
      (await db.intention_tag.get(seedId('intention_tag', 'rest')))?.deleted_at,
    ).not.toBeNull();
  });

  it('does not duplicate a key she already created as her own tag', async () => {
    const mine = await repos.intention_tag.create({ key: 'gratitude', label: 'Gratitud' });

    await loadSeed(
      db,
      nextBundle((b) => {
        b.intentions = [...b.intentions, 'gratitude'];
      }),
      clock,
    );

    expect(await db.intention_tag.where('key').equals('gratitude').toArray()).toEqual([mine]);
  });
});
