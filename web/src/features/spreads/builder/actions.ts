import {
  getDeviceId,
  newId,
  nowIso,
  type ArcanaDB,
  type Clock,
  type SpreadTemplate,
} from '../../../db';
import { copyName, nameTaken, type SpreadFormFields } from './form';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

async function stamp(db: ArcanaDB, clock: Clock) {
  return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
}

export class SpreadNameTakenError extends Error {
  constructor(name: string) {
    super(`a spread named "${name}" already exists`);
    this.name = 'SpreadNameTakenError';
  }
}

/** Names of every live spread, seed and custom, except `exceptId`. */
export async function spreadNames(db: ArcanaDB, exceptId?: string): Promise<string[]> {
  const templates = await db.spread_template
    .filter((row) => live(row) && row.id !== exceptId)
    .toArray();
  return templates.map((row) => row.name);
}

async function customSpread(db: ArcanaDB, id: string): Promise<SpreadTemplate> {
  const template = await db.spread_template.get(id);
  if (!template || !live(template)) throw new Error(`spread template not found: ${id}`);
  if (template.is_seed) throw new Error(`seed spreads are read-only: ${id}`);
  return template;
}

/** Saves a new custom spread. Rejects a name another spread already has (seed or custom). */
export async function createCustomSpread(
  db: ArcanaDB,
  fields: SpreadFormFields,
  clock: Clock = nowIso,
): Promise<SpreadTemplate> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', db.spread_template, async () => {
    if (nameTaken(fields.name, await spreadNames(db))) throw new SpreadNameTakenError(fields.name);
    const template: SpreadTemplate = {
      ...structuredClone(fields),
      is_seed: false,
      seed_key: null,
      id: newId(),
      deleted_at: null,
      server_version: null,
      ...stamped,
    };
    await db.spread_template.add(template);
    return template;
  });
}

/** Saves her changes to a custom spread. Seed spreads are read-only. */
export async function updateCustomSpread(
  db: ArcanaDB,
  id: string,
  fields: SpreadFormFields,
  clock: Clock = nowIso,
): Promise<SpreadTemplate> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', db.spread_template, async () => {
    const template = await customSpread(db, id);
    if (nameTaken(fields.name, await spreadNames(db, id))) {
      throw new SpreadNameTakenError(fields.name);
    }
    const updated: SpreadTemplate = { ...template, ...structuredClone(fields), ...stamped };
    await db.spread_template.put(updated);
    return updated;
  });
}

/**
 * "Duplicar": a new custom spread with the same description and positions (layout included),
 * independent of the original, named by `label` with the first free copy number.
 */
export async function duplicateSpread(
  db: ArcanaDB,
  id: string,
  label: (name: string, n: number) => string,
  clock: Clock = nowIso,
): Promise<SpreadTemplate> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', db.spread_template, async () => {
    const original = await db.spread_template.get(id);
    if (!original || !live(original)) throw new Error(`spread template not found: ${id}`);
    const copy: SpreadTemplate = {
      name: copyName((n) => label(original.name, n), await spreadNames(db)),
      description: original.description,
      positions: structuredClone(original.positions),
      is_seed: false,
      seed_key: null,
      id: newId(),
      deleted_at: null,
      server_version: null,
      ...stamped,
    };
    await db.spread_template.add(copy);
    return copy;
  });
}

/** Tombstones a custom spread. Readings made with it keep their snapshot. */
export async function deleteCustomSpread(
  db: ArcanaDB,
  id: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  await db.transaction('rw', db.spread_template, async () => {
    const template = await customSpread(db, id);
    await db.spread_template.put({ ...template, ...stamped, deleted_at: stamped.updated_at });
  });
}
