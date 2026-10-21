// An in-memory stand-in for the API, for sync engine tests. Its sync is plain last-write-wins
// on `updated_at` (newer overwrites, equal is a no-op, older is rejected and returned), with
// pages, the 24 h clock_ahead check and an epoch. Conflict rows, constraints and the rest of the
// server's rules are tested in the API (api/tests/test_sync.py) and end to end in T3.9.

import type {
  Api,
  ApiResult,
  PulledChange,
  RecordError,
  SyncBadRequest,
  SyncRequest,
  SyncResponse,
  TokenPair,
  TokenRefreshed,
} from '../sync/api';
import type { SyncedTableName } from '../db';

interface StoredRecord {
  id: string;
  updated_at: string;
  [field: string]: unknown;
}

interface StoredRow {
  table: SyncedTableName;
  record: StoredRecord;
  version: number;
}

/** What to do with the next sync request instead of (or after) handling it. */
export type SyncScript =
  /** Handle it, then drop the response: the app was closed or the network died. */
  'lose_response' | ApiResult<SyncResponse, SyncBadRequest>;

const DAY_MS = 24 * 60 * 60_000;

export class FakeSyncServer implements Api {
  rows = new Map<string, StoredRow>();
  version = 0;
  epoch = crypto.randomUUID();
  pageSize = 500;
  now = () => Date.now();

  /** Every sync request received with a valid token, in order. */
  requests: SyncRequest[] = [];
  refreshCalls = 0;
  /** Scripted outcomes for the next sync requests, consumed in order. */
  script: SyncScript[] = [];
  /** Rotate the refresh token, then drop the response. */
  loseNextRefreshResponse = false;

  private access = new Set<string>();
  private refreshTokens = new Map<string, 'valid' | 'blacklisted'>();
  private issued = 0;
  private held: Promise<void> | null = null;

  issueTokens(): TokenPair {
    this.issued++;
    const n = String(this.issued);
    const pair = { access: `access-${n}`, refresh: `refresh-${n}` };
    this.access.add(pair.access);
    this.refreshTokens.set(pair.refresh, 'valid');
    return pair;
  }

  /** Every access token issued so far stops working (as after 15 minutes). */
  expireAccessTokens(): void {
    this.access.clear();
  }

  /** Holds sync responses until the returned function is called. */
  hold(): () => void {
    let release = () => {};
    this.held = new Promise((resolve) => {
      release = () => {
        this.held = null;
        resolve();
      };
    });
    return release;
  }

  /** A row written on the server by another device. */
  put(table: SyncedTableName, record: StoredRecord): void {
    this.version++;
    this.rows.set(`${table}:${record.id}`, { table, record, version: this.version });
  }

  get(table: SyncedTableName, id: string): StoredRecord | undefined {
    return this.rows.get(`${table}:${id}`)?.record;
  }

  /** A fresh database: no rows, the sequence restarts and the epoch changes. */
  resetDatabase(): void {
    this.rows.clear();
    this.version = 0;
    this.epoch = crypto.randomUUID();
  }

  login(): Promise<ApiResult<TokenPair>> {
    return Promise.resolve({ kind: 'ok', body: this.issueTokens() });
  }

  async refresh(refreshToken: string): Promise<ApiResult<TokenRefreshed>> {
    this.refreshCalls++;
    await Promise.resolve();
    if (this.refreshTokens.get(refreshToken) !== 'valid') return { kind: 'unauthorized' };
    this.refreshTokens.set(refreshToken, 'blacklisted');
    const pair = this.issueTokens();
    if (this.loseNextRefreshResponse) {
      this.loseNextRefreshResponse = false;
      return { kind: 'network' };
    }
    return { kind: 'ok', body: pair };
  }

  async sync(access: string, body: SyncRequest): Promise<ApiResult<SyncResponse, SyncBadRequest>> {
    await Promise.resolve();
    if (this.held) await this.held;
    if (!this.access.has(access)) return { kind: 'unauthorized' };
    this.requests.push(structuredClone(body));
    const scripted = this.script.shift();
    if (scripted !== undefined && scripted !== 'lose_response') return scripted;
    const result = this.handle(body);
    return scripted === 'lose_response' ? { kind: 'network' } : result;
  }

  private handle(body: SyncRequest): ApiResult<SyncResponse, SyncBadRequest> {
    const now = this.now();
    const changes = body.changes ?? [];
    const cursor = body.cursor ?? 0;

    const errors: RecordError[] = [];
    changes.forEach((change, index) => {
      if (Date.parse(change.record.updated_at) > now + DAY_MS) {
        errors.push({
          index,
          table: change.table,
          id: change.record.id,
          code: 'clock_ahead',
          detail: 'updated_at is more than 24 h after server time.',
        });
      }
    });
    if (errors.length > 0) return { kind: 'rejected', body: { records: errors } };

    const applied: string[] = [];
    const written = new Set<string>();
    const returned = new Map<string, StoredRow>();
    for (const change of changes) {
      const key = `${change.table}:${change.record.id}`;
      const stored = this.rows.get(key);
      const record: StoredRecord = { ...change.record, device_id: body.device_id };
      if (!stored || record.updated_at > stored.record.updated_at) {
        this.version++;
        this.rows.set(key, { table: change.table, record, version: this.version });
        written.add(key);
        applied.push(record.id);
      } else if (record.updated_at === stored.record.updated_at) {
        applied.push(record.id);
      } else {
        returned.set(key, stored);
      }
    }

    const page = [...this.rows.entries()]
      .filter(([, row]) => row.version > cursor)
      .sort(([, a], [, b]) => a.version - b.version)
      .slice(0, this.pageSize);
    const nextCursor = page.at(-1)?.[1].version ?? cursor;
    for (const [key, row] of page) if (!written.has(key)) returned.set(key, row);

    return {
      kind: 'ok',
      body: {
        applied,
        conflicts: [],
        changes: [...returned.values()]
          .sort((a, b) => a.version - b.version)
          .map((row) => pulled(row)),
        cursor: nextCursor,
        server_time: new Date(now).toISOString(),
        epoch: this.epoch,
      },
    };
  }
}

function pulled(row: StoredRow): PulledChange {
  // Test-only: the fake stores records loosely; the real wire shapes are checked by the
  // type-level drift test and the API's own tests.
  return {
    table: row.table,
    record: { ...row.record, server_version: row.version },
  } as PulledChange;
}
