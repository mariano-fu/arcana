// Orphaned rows (T3.7): a live session whose ficha was deleted, as when one device deletes a
// client while another, offline, adds a session to it. The server accepts both (plan.md, Sync
// rule 4); she decides: restore the ficha or delete the session.
//
// v1 covers sessions only; payments, readings and card draws under a deleted session are an
// open issue (plan.md).

import type { ArcanaDB, Client, Session } from '../../db';

export interface OrphanSession {
  session: Session;
  /** The deleted ficha. */
  client: Client;
  readings: number;
  payments: number;
}

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

/** Live sessions of a deleted ficha, newest first. A ficha not synced here yet doesn't count. */
export async function findOrphanSessions(db: ArcanaDB): Promise<OrphanSession[]> {
  const sessions = await db.session.filter(live).toArray();
  const orphans: OrphanSession[] = [];
  for (const session of sessions) {
    const client = await db.client.get(session.client_id);
    if (!client || client.deleted_at === null) continue;
    const [readings, payments] = await Promise.all([
      db.reading.where('session_id').equals(session.id).filter(live).count(),
      db.payment.where('session_id').equals(session.id).filter(live).count(),
    ]);
    orphans.push({ session, client, readings, payments });
  }
  return orphans.sort((a, b) => b.session.started_at.localeCompare(a.session.started_at));
}
