import { db } from '../../db';
import { cardsSeed } from '../../seed/cards';
import { SEED_VERSION_KEYS } from '../../seed/loader';

export interface AppBuild {
  /** package.json version, e.g. `0.1.0`. */
  version: string;
  /** Short commit SHA, or `dev` when built outside git. */
  commit: string;
  /** When this build was made (ISO 8601). */
  builtAt: string;
}

export const appBuild: AppBuild = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILT_AT__,
};

/** `21 oct 2026`. */
export function formatBuildDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium' }).format(new Date(iso));
}

export interface DataVersions {
  /** The local database schema version (Dexie `verno`). */
  schema: number;
  /** Bundled with the app; read straight from the seed file. */
  cards: number;
  /** Loaded into the database on this device; null until the first load finishes. */
  spreads: number | null;
  crystals: number | null;
}

export async function dataVersions(): Promise<DataVersions> {
  const loaded = async (key: string) => {
    const value = (await db.meta.get(key))?.value;
    return value === undefined ? null : Number(value);
  };
  return {
    schema: db.verno,
    cards: cardsSeed.version,
    spreads: await loaded(SEED_VERSION_KEYS.spreads),
    crystals: await loaded(SEED_VERSION_KEYS.crystals),
  };
}
