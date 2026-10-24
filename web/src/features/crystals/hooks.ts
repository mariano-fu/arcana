import { useLiveQuery } from 'dexie-react-hooks';

import { db, type ArcanaDB, type Crystal, type SessionCrystal } from '../../db';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

export interface AttachedCrystal {
  attachment: SessionCrystal;
  /** Hidden or deleted crystals are still shown, labelled (T2.9 Q2, Q4). */
  crystal: Crystal;
}

/**
 * The crystals attached to a session, in the order she attached them. Attachments under a
 * deleted session are hidden. An attachment whose crystal row isn't on this device (a seed
 * crystal from a newer app version, until this one updates) is left out until the row exists.
 */
export async function getSessionCrystals(
  target: ArcanaDB,
  sessionId: string,
): Promise<AttachedCrystal[]> {
  const session = await target.session.get(sessionId);
  if (!session || !live(session)) return [];
  const attachments = await target.session_crystal
    .where('session_id')
    .equals(sessionId)
    .filter(live)
    .toArray();
  const crystals = await target.crystal.bulkGet(attachments.map((row) => row.crystal_id));
  return attachments
    .flatMap((attachment, index) => {
      const crystal = crystals[index];
      return crystal ? [{ attachment, crystal }] : [];
    })
    .sort(
      (a, b) =>
        a.attachment.updated_at.localeCompare(b.attachment.updated_at) ||
        a.attachment.id.localeCompare(b.attachment.id),
    );
}

/** `getSessionCrystals`, live; undefined while loading. */
export function useSessionCrystals(sessionId: string): AttachedCrystal[] | undefined {
  return useLiveQuery(() => getSessionCrystals(db, sessionId), [sessionId]);
}
