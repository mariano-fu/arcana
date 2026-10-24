// JWTs for the sync API (specs/plan.md, "Security"). Tokens live in the `auth` table.
//
// Refresh tokens rotate: each refresh blacklists the one it used. So refreshes are serialized
// across tabs with a Web Lock, and inside it the stored tokens are read again: if another tab
// (or an earlier caller) already rotated them, the new access token is used as is instead of
// spending the old, now blacklisted, refresh token. A refused refresh (for example after a
// lost refresh response) clears only the `auth` table; local data is never touched by an auth
// failure.

import type { ArcanaDB } from '../db';
import type { Api, Credentials } from './api';
import { AUTH_LOCK, defaultLocks, type Locks } from './locks';
import { readStatus, writeStatus } from './status';

const TOKENS = 'tokens';

/** `offline`/`error`: the refresh didn't happen (no connection, server error); try again later. */
export type RefreshOutcome = 'refreshed' | 'expired' | 'offline' | 'error';
export type LoginOutcome = 'ok' | 'invalid' | 'throttled' | 'unavailable';

export interface Auth {
  /** The stored access token, read fresh each time (another tab may have rotated it). */
  getAccess(): Promise<string | undefined>;
  /** Logs in and stores the tokens. For Settings (T3.8). */
  login(credentials: Credentials): Promise<LoginOutcome>;
  /** After `staleAccess` got a 401: refreshes once, or adopts a refresh done meanwhile. */
  refreshAfter(staleAccess: string): Promise<RefreshOutcome>;
  /** Forgets the tokens. Clears the `auth` table only. */
  expire(): Promise<void>;
}

export function createAuth(db: ArcanaDB, api: Api, locks: Locks = defaultLocks()): Auth {
  const expire = async () => {
    await db.auth.delete(TOKENS);
  };

  return {
    async getAccess() {
      return (await db.auth.get(TOKENS))?.access;
    },

    async login(credentials) {
      const result = await api.login(credentials);
      if (result.kind === 'ok') {
        // A 200 that isn't a token pair didn't come from the API.
        const body: unknown = result.body;
        if (!isTokenPair(body)) return 'unavailable';
        await locks.request(AUTH_LOCK, async () => {
          await db.auth.put({ key: TOKENS, access: body.access, refresh: body.refresh });
        });
        const status = await readStatus(db);
        if (status.state === 'session_expired' || status.state === 'signed_out') {
          await writeStatus(db, { ...status, state: 'idle' });
        }
        return 'ok';
      }
      if (result.kind === 'unauthorized' || result.kind === 'rejected') return 'invalid';
      if (result.kind === 'throttled') return 'throttled';
      return 'unavailable';
    },

    refreshAfter(staleAccess) {
      return locks.request(AUTH_LOCK, async (): Promise<RefreshOutcome> => {
        const tokens = await db.auth.get(TOKENS);
        if (!tokens) return 'expired';
        if (tokens.access !== staleAccess) return 'refreshed';

        const result = await api.refresh(tokens.refresh);
        if (result.kind === 'ok') {
          await db.auth.put({ key: TOKENS, ...result.body });
          return 'refreshed';
        }
        if (result.kind === 'unauthorized' || result.kind === 'rejected') {
          await expire();
          return 'expired';
        }
        return result.kind === 'network' ? 'offline' : 'error';
      });
    },

    expire,
  };
}

function isTokenPair(body: unknown): body is { access: string; refresh: string } {
  if (typeof body !== 'object' || body === null) return false;
  const { access, refresh } = body as Record<string, unknown>;
  return typeof access === 'string' && typeof refresh === 'string';
}
