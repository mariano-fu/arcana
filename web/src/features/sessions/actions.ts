import { z } from 'zod';

import { getDeviceId, newId, nowIso, type ArcanaDB, type Clock, type Session } from '../../db';
import { CURRENCIES, sumByCurrency, type CurrencyTotals } from '../payments';
import { defaultSessionFields, pickSessionFields, sameSessionFields, SESSION_TYPES } from './form';

const live = (row: { deleted_at: string | null }) => row.deleted_at === null;

async function stamp(db: ArcanaDB, clock: Clock) {
  return { updated_at: clock(), device_id: await getDeviceId(db), pending: 1 as const };
}

/**
 * Local-only `meta` marker for a session still in its just-created state, so a mistaken
 * "Nueva sesión" can be discarded later: on leaving the page, or on the next app start if the
 * app was closed first. Only the device that created the session has it, so another device
 * never discards a session she is still working on.
 */
const FRESH_SESSION_PREFIX = 'fresh_session:';
const freshKey = (sessionId: string) => `${FRESH_SESSION_PREFIX}${sessionId}`;

const freshSessionSchema = z.object({
  /** The editable fields as created. */
  created: z.object({
    started_at: z.string(),
    type: z.enum(SESSION_TYPES),
    price_minor: z.number().nullable(),
    currency: z.enum(CURRENCIES),
    notes: z.string(),
    follow_up_note: z.string(),
    follow_up_date: z.string().nullable(),
  }),
  /** The session's `updated_at` as created. */
  updated_at: z.string(),
  /** Creating the session unarchived the client; discarding it archives them again. */
  unarchived: z.boolean(),
});

function parseFreshMarker(value: string): z.infer<typeof freshSessionSchema> | null {
  try {
    const result = freshSessionSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export interface CreatedSession {
  session: Session;
  /** True when the client was archived and creating the session brought them back. */
  unarchived: boolean;
}

/**
 * Starts a session for the client with the defaults (now, in person, no price, colones). An
 * archived client is unarchived in the same transaction: they came back.
 */
export async function createSession(
  db: ArcanaDB,
  clientId: string,
  clock: Clock = nowIso,
): Promise<CreatedSession> {
  const stamped = await stamp(db, clock);
  return db.transaction('rw', [db.client, db.session, db.meta], async () => {
    const client = await db.client.get(clientId);
    if (!client || client.deleted_at !== null) throw new Error(`client not found: ${clientId}`);

    const session: Session = {
      ...defaultSessionFields(stamped.updated_at),
      client_id: clientId,
      id: newId(),
      deleted_at: null,
      server_version: null,
      ...stamped,
    };
    await db.session.add(session);
    if (client.archived) await db.client.put({ ...client, archived: false, ...stamped });
    const fresh: z.infer<typeof freshSessionSchema> = {
      created: pickSessionFields(session),
      updated_at: session.updated_at,
      unarchived: client.archived,
    };
    await db.meta.put({ key: freshKey(session.id), value: JSON.stringify(fresh) });
    return { session, unarchived: client.archived };
  });
}

export interface SessionDeletionSummary {
  readings: number;
  payments: number;
  /** Attached crystals. */
  crystals: number;
  /** Total paid per currency (minor units); currencies are never summed together. */
  paidByCurrency: CurrencyTotals;
}

/** What deleting a session would remove, for the confirmation dialog. Tombstones aren't counted. */
export async function getSessionDeletionSummary(
  db: ArcanaDB,
  sessionId: string,
): Promise<SessionDeletionSummary> {
  const [readings, payments, crystals] = await Promise.all([
    db.reading.where('session_id').equals(sessionId).filter(live).count(),
    db.payment.where('session_id').equals(sessionId).filter(live).toArray(),
    db.session_crystal.where('session_id').equals(sessionId).filter(live).count(),
  ]);
  return {
    readings,
    payments: payments.length,
    crystals,
    paidByCurrency: sumByCurrency(payments),
  };
}

/**
 * Tombstones the session and its payments, readings, card draws and attached crystals. Call
 * inside a transaction.
 */
async function tombstoneSession(
  db: ArcanaDB,
  session: Session,
  tombstone: Awaited<ReturnType<typeof stamp>> & { deleted_at: string },
): Promise<void> {
  const payments = await db.payment.where('session_id').equals(session.id).filter(live).toArray();
  const readings = await db.reading.where('session_id').equals(session.id).filter(live).toArray();
  const draws = await db.card_draw
    .where('reading_id')
    .anyOf(readings.map((reading) => reading.id))
    .filter(live)
    .toArray();
  const crystals = await db.session_crystal
    .where('session_id')
    .equals(session.id)
    .filter(live)
    .toArray();

  await db.session.put({ ...session, ...tombstone });
  await db.payment.bulkPut(payments.map((row) => ({ ...row, ...tombstone })));
  await db.reading.bulkPut(readings.map((row) => ({ ...row, ...tombstone })));
  await db.card_draw.bulkPut(draws.map((row) => ({ ...row, ...tombstone })));
  await db.session_crystal.bulkPut(crystals.map((row) => ({ ...row, ...tombstone })));
}

/**
 * Soft-deletes the session and everything under it (payments, readings, card draws, attached
 * crystals) in one transaction, so the tombstones sync and nothing is left orphaned.
 */
export async function deleteSession(
  db: ArcanaDB,
  sessionId: string,
  clock: Clock = nowIso,
): Promise<void> {
  const stamped = await stamp(db, clock);
  const tombstone = { ...stamped, deleted_at: stamped.updated_at };
  await db.transaction(
    'rw',
    [db.session, db.payment, db.reading, db.card_draw, db.session_crystal, db.meta],
    async () => {
      await db.meta.delete(freshKey(sessionId));
      const session = await db.session.get(sessionId);
      if (!session || session.deleted_at !== null) return;
      await tombstoneSession(db, session, tombstone);
    },
  );
}

export interface DiscardOptions {
  /**
   * Also require `updated_at` to be unchanged, so a session edited and edited back is kept.
   * The startup sweep uses this; leaving the page compares field values only.
   */
  requireUnmodified?: boolean;
  clock?: Clock;
}

/**
 * Silently discards a session created by mistake: if it still has its "Nueva sesión" marker,
 * its fields are exactly as created and it has no readings, payments or attached crystals, it is
 * tombstoned (and a client it unarchived is archived again). The marker is removed either way:
 * once checked, the session is no longer just created. Returns whether it was discarded.
 */
export async function discardIfUntouched(
  db: ArcanaDB,
  sessionId: string,
  { requireUnmodified = false, clock = nowIso }: DiscardOptions = {},
): Promise<boolean> {
  const stamped = await stamp(db, clock);
  const tombstone = { ...stamped, deleted_at: stamped.updated_at };
  return db.transaction(
    'rw',
    [db.client, db.session, db.payment, db.reading, db.card_draw, db.session_crystal, db.meta],
    async () => {
      const marker = await db.meta.get(freshKey(sessionId));
      if (!marker) return false;
      await db.meta.delete(marker.key);
      const fresh = parseFreshMarker(marker.value);
      if (!fresh) return false;

      const session = await db.session.get(sessionId);
      if (!session || session.deleted_at !== null) return false;
      if (!sameSessionFields(pickSessionFields(session), fresh.created)) return false;
      if (requireUnmodified && session.updated_at !== fresh.updated_at) return false;
      // Only live rows count: a crystal attached and removed again leaves it untouched (T2.9 Q3).
      const { readings, payments, crystals } = await getSessionDeletionSummary(db, sessionId);
      if (readings > 0 || payments > 0 || crystals > 0) return false;

      await tombstoneSession(db, session, tombstone);
      if (fresh.unarchived) {
        const client = await db.client.get(session.client_id);
        if (client && client.deleted_at === null && !client.archived) {
          await db.client.put({ ...client, archived: true, ...stamped });
        }
      }
      return true;
    },
  );
}

/**
 * Startup sweep for the app-closed case: discards every session still in its just-created
 * state (see `discardIfUntouched`, with `requireUnmodified`). `except` skips the session the
 * app opened on, which leaving its page will handle. Returns how many were discarded.
 */
export async function sweepFreshSessions(
  db: ArcanaDB,
  { except, clock = nowIso }: { except?: string | null; clock?: Clock } = {},
): Promise<number> {
  const keys = await db.meta.where('key').startsWith(FRESH_SESSION_PREFIX).primaryKeys();
  let discarded = 0;
  for (const key of keys) {
    const sessionId = key.slice(FRESH_SESSION_PREFIX.length);
    if (sessionId === except) continue;
    if (await discardIfUntouched(db, sessionId, { requireUnmodified: true, clock })) discarded++;
  }
  return discarded;
}
