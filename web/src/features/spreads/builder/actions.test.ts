import { db, repos } from '../../../db';
import { bundledSeed, loadSeed, seedId } from '../../../seed/loader';
import { clearDb } from '../../clients/test-utils';
import {
  createCustomSpread,
  deleteCustomSpread,
  duplicateSpread,
  SpreadNameTakenError,
  spreadNames,
  updateCustomSpread,
} from './actions';
import { parseSpreadForm, templateToForm } from './form';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CELTIC_CROSS = seedId('spread_template', 'celtic-cross');
const label = (name: string, n: number) =>
  n === 1 ? `${name} (copia)` : `${name} (copia ${String(n)})`;

const fields = (name: string) => ({
  name,
  description: '',
  positions: [{ index: 1, name: 'Uno', meaning: '', layout: null }],
});

beforeEach(async () => {
  await clearDb();
  await loadSeed(db);
});

describe('custom spreads', () => {
  it('creates a custom spread with a UUIDv7 id, stamped for sync', async () => {
    const template = await createCustomSpread(db, fields('Mi tirada'));
    expect(template.id).toMatch(UUID_V7);
    expect(template).toMatchObject({
      is_seed: false,
      seed_key: null,
      pending: 1,
      deleted_at: null,
    });
    expect(await repos.spread_template.get(template.id)).toEqual(template);
  });

  it('rejects a name a seed or custom spread already has', async () => {
    await createCustomSpread(db, fields('Mi tirada'));
    await expect(createCustomSpread(db, fields('mi TIRADA'))).rejects.toThrow(SpreadNameTakenError);
    await expect(createCustomSpread(db, fields('Cruz Célta'))).rejects.toThrow(
      SpreadNameTakenError,
    );
  });

  it('lets a spread keep its own name and frees the name of a deleted one', async () => {
    const template = await createCustomSpread(db, fields('Mi tirada'));
    await updateCustomSpread(db, template.id, { ...fields('Mi tirada'), description: 'Nueva' });
    await deleteCustomSpread(db, template.id);
    await expect(createCustomSpread(db, fields('Mi tirada'))).resolves.toBeDefined();
  });

  it('never edits or deletes a seed spread', async () => {
    await expect(updateCustomSpread(db, CELTIC_CROSS, fields('X'))).rejects.toThrow();
    await expect(deleteCustomSpread(db, CELTIC_CROSS)).rejects.toThrow();
    expect((await repos.spread_template.get(CELTIC_CROSS))?.name).toBe('Cruz Celta');
  });

  it('tombstones a deleted spread so it leaves the name list', async () => {
    const template = await createCustomSpread(db, fields('Mi tirada'));
    await deleteCustomSpread(db, template.id);
    const stored = await db.spread_template.get(template.id);
    expect(stored?.deleted_at).toBe(stored?.updated_at);
    expect(stored?.pending).toBe(1);
    expect(await spreadNames(db)).not.toContain('Mi tirada');
  });
});

describe('duplicateSpread', () => {
  it('numbers repeated copies and reuses a freed number', async () => {
    const first = await duplicateSpread(db, CELTIC_CROSS, label);
    const second = await duplicateSpread(db, CELTIC_CROSS, label);
    const third = await duplicateSpread(db, CELTIC_CROSS, label);
    expect([first.name, second.name, third.name]).toEqual([
      'Cruz Celta (copia)',
      'Cruz Celta (copia 2)',
      'Cruz Celta (copia 3)',
    ]);

    await deleteCustomSpread(db, second.id);
    expect((await duplicateSpread(db, CELTIC_CROSS, label)).name).toBe('Cruz Celta (copia 2)');
  });

  it('copies positions and layout into an independent custom spread', async () => {
    const seed = await repos.spread_template.get(CELTIC_CROSS);
    const copy = await duplicateSpread(db, CELTIC_CROSS, label);
    expect(copy).toMatchObject({
      is_seed: false,
      seed_key: null,
      description: seed?.description,
      positions: seed?.positions,
    });
    expect(copy.id).toMatch(UUID_V7);

    // A newer seed rewrites the seed row, never the copy.
    const bundle = structuredClone(bundledSeed);
    bundle.spreads.version += 1;
    const cross = bundle.spreads.spreads.find((s) => s.key === 'celtic-cross');
    if (cross) cross.name = 'Cruz Celta nueva';
    await loadSeed(db, bundle);
    expect((await repos.spread_template.get(CELTIC_CROSS))?.name).toBe('Cruz Celta nueva');
    expect(await repos.spread_template.get(copy.id)).toEqual(copy);
  });

  it('keeps indexes 1..n when a position is removed from a copy', async () => {
    const copy = await duplicateSpread(db, CELTIC_CROSS, label);
    const values = templateToForm(copy);
    values.positions.splice(4, 1); // drop 5 · Corona
    const result = parseSpreadForm(values, await spreadNames(db, copy.id));
    if (!result.ok) throw new Error('form should be valid');

    const saved = await updateCustomSpread(db, copy.id, result.fields);
    expect(saved.positions.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(saved.positions.map((p) => p.name)).not.toContain('Corona');
    expect((await repos.spread_template.get(CELTIC_CROSS))?.positions).toHaveLength(10);
  });
});
