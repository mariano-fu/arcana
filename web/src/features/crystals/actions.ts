import { v5 as uuidv5 } from 'uuid';

import { getDeviceId, nowIso, type ArcanaDB, type Clock, type SessionCrystal } from '../../db';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

async function stamp(db: ArcanaDB, clock: Clock) {
  return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
}

/** Fixed namespace for attached crystal ids. Never change it: synced rows depend on it. */
export const SESSION_CRYSTAL_ID_NAMESPACE = 'bfcb1555-c83a-448c-830f-8ff852b91360';

/**
 * The id of a crystal attached to a session: a UUIDv5 of the pair, the same on every device
 * (like `card_draw`). A crystal is attached at most once per session, so attaching it on two
 * devices writes the same row.
 */
export function sessionCrystalId(sessionId: string, crystalId: string): string {
  return uuidv5(`session_crystal:${sessionId}:${crystalId}`, SESSION_CRYSTAL_ID_NAMESPACE);
}

/**
 * Attaches the crystal to the session. Attaching one that was removed brings the same row back;
 * one already attached is left as it is.
 */
export async function attachCrystal(
  db: ArcanaDB,
  sessionId: string,
  crystalId: string,
  clock: Clock = nowIso,
): Promise<SessionCrystal> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', [db.session, db.crystal, db.session_crystal], async () => {
    const session = await db.session.get(sessionId);
    if (!session || !live(session)) throw new Error(`session not found: ${sessionId}`);
    const crystal = await db.crystal.get(crystalId);
    if (!crystal || !live(crystal)) throw new Error(`crystal not found: ${crystalId}`);

    const id = sessionCrystalId(sessionId, crystalId);
    const existing = await db.session_crystal.get(id);
    if (existing && live(existing)) return existing;
    const attached: SessionCrystal = {
      session_id: sessionId,
      crystal_id: crystalId,
      id,
      server_version: existing?.server_version ?? null,
      ...stamped,
      deleted_at: null,
    };
    await db.session_crystal.put(attached);
    return attached;
  });
}

/** Removes the crystal from the session (a tombstone). Does nothing if it isn't attached. */
export async function detachCrystal(
  db: ArcanaDB,
  sessionId: string,
  crystalId: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  await db.transaction('rw', [db.session_crystal], async () => {
    const existing = await db.session_crystal.get(sessionCrystalId(sessionId, crystalId));
    if (!existing || !live(existing)) return;
    await db.session_crystal.put({ ...existing, ...stamped, deleted_at: stamped.updated_at });
  });
}
