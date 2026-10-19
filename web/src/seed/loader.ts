// Seed loader: copies the bundled spread, crystal and intention tag seeds into IndexedDB.
//
// Runs on app start. Each seed file has a `version`; the loader compares it with the version
// stored in `meta` (`seed_version:spreads`, `seed_version:crystals`) and only touches a table
// when they differ. The rules (specs/plan.md, "Seed vs. user edits"):
// - Seed rows get a deterministic UUIDv5 id from their table and key, so every device creates
//   the same rows and syncing never duplicates them. They are written with `pending = 0`: each
//   device derives them from its own bundle, so only her edits sync.
// - Spreads: seed spreads are read-only in the app, so they are always overwritten with the
//   bundled version. Her custom spreads (`is_seed = false`) are never touched.
// - Crystals: new seed rows are inserted; existing ones are updated only while
//   `user_modified = false`, and only their seed content (`hidden` is hers).
// - Intention tags follow the crystals version and are add-only, with `label: null` so the UI
//   shows the `es.json` label for the key.
// - Rows she deleted (tombstones) stay deleted, and rows dropped from a newer seed are kept.

import { v5 as uuidv5 } from 'uuid';

import type { ArcanaDB } from '../db/db.ts';
import { getDeviceId } from '../db/device.ts';
import { nowIso } from '../db/ids.ts';
import type { Clock } from '../db/repository.ts';
import type { Crystal, IntentionTag, SpreadTemplate } from '../db/types.ts';
import { crystalsSeed, INTENTIONS, type CrystalsFile } from './crystals.ts';
import { spreadsSeed, type SpreadsFile } from './spreads.ts';

/** Fixed namespace for seed row ids. Never change it: synced rows and references depend on it. */
export const SEED_ID_NAMESPACE = '267336bb-cd50-49bd-b4aa-f52c14e54cbb';

export type SeedTableName = 'spread_template' | 'crystal' | 'intention_tag';

/** The id of the seed row for `key` in `table`: the same on every device. */
export function seedId(table: SeedTableName, key: string): string {
  return uuidv5(`${table}:${key}`, SEED_ID_NAMESPACE);
}

export interface SeedBundle {
  spreads: SpreadsFile;
  crystals: CrystalsFile;
  /** Seed intention tag keys; loaded with the crystals version. */
  intentions: readonly string[];
}

export const bundledSeed: SeedBundle = {
  spreads: spreadsSeed,
  crystals: crystalsSeed,
  intentions: INTENTIONS,
};

export const SEED_VERSION_KEYS = {
  spreads: 'seed_version:spreads',
  crystals: 'seed_version:crystals',
} as const;

/** Brings the local seed rows up to the bundled versions. Safe to run more than once. */
export async function loadSeed(
  db: ArcanaDB,
  bundle: SeedBundle = bundledSeed,
  clock: Clock = nowIso,
): Promise<void> {
  const deviceId = await getDeviceId(db);
  const tables = [db.spread_template, db.crystal, db.intention_tag, db.meta];

  await db.transaction('rw', tables, async () => {
    const stamp = { updated_at: clock(), device_id: deviceId };

    async function isCurrent(key: string, version: number): Promise<boolean> {
      return (await db.meta.get(key))?.value === String(version);
    }

    if (!(await isCurrent(SEED_VERSION_KEYS.spreads, bundle.spreads.version))) {
      for (const spread of bundle.spreads.spreads) {
        const id = seedId('spread_template', spread.key);
        const existing = await db.spread_template.get(id);
        if (existing?.deleted_at) continue;
        const row: SpreadTemplate = {
          id,
          name: spread.name,
          description: spread.description,
          positions: spread.positions,
          is_seed: true,
          seed_key: spread.key,
          deleted_at: null,
          server_version: existing?.server_version ?? null,
          pending: existing?.pending ?? 0,
          ...stamp,
        };
        await db.spread_template.put(row);
      }
      await db.meta.put({ key: SEED_VERSION_KEYS.spreads, value: String(bundle.spreads.version) });
    }

    if (!(await isCurrent(SEED_VERSION_KEYS.crystals, bundle.crystals.version))) {
      for (const crystal of bundle.crystals.crystals) {
        const id = seedId('crystal', crystal.key);
        const existing = await db.crystal.get(id);
        if (existing && (existing.deleted_at || existing.user_modified)) continue;
        const row: Crystal = {
          id,
          seed_key: crystal.key,
          name: crystal.name,
          colors: crystal.colors,
          chakras: crystal.chakras,
          signs: crystal.signs,
          intentions: crystal.intentions,
          description: crystal.description,
          care: crystal.care,
          hidden: existing?.hidden ?? false,
          user_modified: false,
          deleted_at: null,
          server_version: existing?.server_version ?? null,
          pending: existing?.pending ?? 0,
          ...stamp,
        };
        await db.crystal.put(row);
      }

      for (const key of bundle.intentions) {
        // By key, not id: tombstones and her own tag with the same key both count as present.
        if (await db.intention_tag.where('key').equals(key).first()) continue;
        const row: IntentionTag = {
          id: seedId('intention_tag', key),
          key,
          label: null,
          deleted_at: null,
          server_version: null,
          pending: 0,
          ...stamp,
        };
        await db.intention_tag.add(row);
      }
      await db.meta.put({
        key: SEED_VERSION_KEYS.crystals,
        value: String(bundle.crystals.version),
      });
    }
  });
}
