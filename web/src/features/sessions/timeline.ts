import type { Session } from '../../db';

/** Newest first; ties (same minute) fall back to creation order, newest first (UUIDv7 ids). */
export function newestFirst<T extends Pick<Session, 'id' | 'started_at'>>(sessions: T[]): T[] {
  return [...sessions].sort(
    (a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id),
  );
}
