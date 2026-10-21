import type { ArcanaDB } from './db';
import { newId } from './ids';

const DEVICE_ID_KEY = 'device_id';

const cache = new WeakMap<ArcanaDB, Promise<string>>();

/** Returns this device's id, creating and persisting it on first use. */
export function getDeviceId(db: ArcanaDB): Promise<string> {
  let deviceId = cache.get(db);
  if (!deviceId) {
    deviceId = db.transaction('rw', db.meta, async () => {
      const existing = await db.meta.get(DEVICE_ID_KEY);
      if (existing) return existing.value;
      const value = newId();
      await db.meta.add({ key: DEVICE_ID_KEY, value });
      return value;
    });
    // Don't cache a failure; let the next call retry.
    deviceId.catch(() => cache.delete(db));
    cache.set(db, deviceId);
  }
  return deviceId;
}

/** Drops the cached id, for a database that was deleted and recreated (tests). */
export function forgetDeviceId(db: ArcanaDB): void {
  cache.delete(db);
}
