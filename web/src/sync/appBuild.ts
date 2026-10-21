// Clears a sync `stopped` state once when a new build of the app starts (T4.7). A server refusal
// (400) pauses automatic sync until a manual "Sincronizar"; if the refusal came from a bug that
// the new build fixes, sync should not stay paused waiting for her to notice.

import type { ArcanaDB } from '../db';
import { readStatus, writeStatus } from './status';

/** The build that last started on this device, e.g. `0.1.0+bab9523`. */
export const APP_BUILD_KEY = 'app:build';

/**
 * Provisional (T4.7 U2): the build identity is version plus commit, because a bug-fix deploy
 * usually doesn't bump package.json.
 */
export const APP_BUILD = `${__APP_VERSION__}+${__APP_COMMIT__}`;

/**
 * Records `build` and, when it differs from the stored one (or none is stored, as on devices
 * from before T4.7), turns a `stopped` status back into `idle` without its errors. Other
 * states (`clock_ahead`, `session_expired`…) are kept: a new build doesn't fix them. Returns
 * whether it cleared anything.
 */
export async function clearStoppedOnNewBuild(
  db: ArcanaDB,
  build: string = APP_BUILD,
): Promise<boolean> {
  return db.transaction('rw', db.meta, async () => {
    if ((await db.meta.get(APP_BUILD_KEY))?.value === build) return false;
    await db.meta.put({ key: APP_BUILD_KEY, value: build });
    const status = await readStatus(db);
    if (status.state !== 'stopped') return false;
    await writeStatus(db, { ...status, state: 'idle', errors: [] });
    return true;
  });
}
