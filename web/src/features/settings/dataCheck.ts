import type { ArcanaDB } from '../../db';

const DEVICE_ID_KEY = 'device_id';

export interface PhoneIdentity {
  /** The first 8 characters of `meta.device_id`. */
  short: string;
  /** When the local database was created, decoded from the UUIDv7; null if the id isn't one. */
  since: Date | null;
}

export interface DataCounts {
  clients: number;
  sessions: number;
  payments: number;
  readings: number;
  cardDraws: number;
  cardNotes: number;
  /** Spreads she created (seed spreads left out). */
  ownSpreads: number;
  /** Crystals she created plus seed crystals she edited. */
  ownCrystals: number;
}

/**
 * What's stored on this phone, for the T1.16 storage survival check. A wipe gives a
 * new `device_id`, so `phone` tells "same database" apart from "refilled by sync".
 */
export interface DataSummary {
  /** Null when `meta.device_id` is missing. */
  phone: PhoneIdentity | null;
  counts: DataCounts;
  oldestClientCreatedAt: string | null;
  oldestSessionStartedAt: string | null;
}

/** The creation time embedded in a UUIDv7 (its first 48 bits, Unix ms), or null. */
export function uuidv7Date(id: string): Date | null {
  const hex = id.replaceAll('-', '');
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(hex)) return null;
  return new Date(Number.parseInt(hex.slice(0, 12), 16));
}

function oldest(values: string[]): string | null {
  return values.reduce<string | null>((min, v) => (min === null || v < min ? v : min), null);
}

/** Reads only: never creates the device id (`getDeviceId` would) or writes anything else. */
export async function dataSummary(db: ArcanaDB): Promise<DataSummary> {
  return db.transaction('r', db.tables, async () => {
    const deviceId = (await db.meta.get(DEVICE_ID_KEY))?.value;
    const live = (row: { deleted_at: string | null }) => row.deleted_at === null;
    const clients = await db.client.filter(live).toArray();
    const sessions = await db.session.filter(live).toArray();
    return {
      phone: deviceId ? { short: deviceId.slice(0, 8), since: uuidv7Date(deviceId) } : null,
      counts: {
        clients: clients.length,
        sessions: sessions.length,
        payments: await db.payment.filter(live).count(),
        readings: await db.reading.filter(live).count(),
        cardDraws: await db.card_draw.filter(live).count(),
        cardNotes: await db.card_note.filter(live).count(),
        ownSpreads: await db.spread_template.filter((s) => live(s) && !s.is_seed).count(),
        ownCrystals: await db.crystal
          .filter((c) => live(c) && (c.seed_key === null || c.user_modified))
          .count(),
      },
      oldestClientCreatedAt: oldest(clients.map((c) => c.created_at)),
      oldestSessionStartedAt: oldest(sessions.map((s) => s.started_at)),
    };
  });
}
