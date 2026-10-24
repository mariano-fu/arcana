// HTTP calls to the API. Every body is typed with the generated `api.gen.ts` (from
// api/openapi.yaml, drift-checked in CI); responses are not re-validated at runtime.

import type { components } from './api.gen';

export type Schemas = components['schemas'];
export type SyncRequest = Schemas['SyncRequest'];
export type SyncResponse = Schemas['SyncResponse'];
export type SyncBadRequest = Schemas['SyncBadRequest'];
export type SyncRejected = Schemas['SyncRejected'];
export type RecordError = Schemas['RecordError'];
export type PushChange = Schemas['PushChangeRequest'];
export type PulledChange = Schemas['PulledChange'];
export type PushResult = Schemas['PushResult'];
export type TokenPair = Schemas['TokenObtainPair'];
export type TokenRefreshed = Schemas['TokenRefresh'];
export type Credentials = Schemas['TokenObtainPairRequest'];

/** How a call ended. Only `ok` and `rejected` (a 400) carry a body. */
export type ApiResult<T, Rejected = never> =
  | { kind: 'ok'; body: T }
  | { kind: 'rejected'; body: Rejected }
  | { kind: 'unauthorized' }
  | { kind: 'throttled' }
  | { kind: 'server_error'; status: number }
  | { kind: 'network' };

export type ApiFailure = Exclude<ApiResult<unknown, unknown>, { kind: 'ok' | 'rejected' }>;

export interface Api {
  login(credentials: Credentials): Promise<ApiResult<TokenPair>>;
  refresh(refreshToken: string): Promise<ApiResult<TokenRefreshed>>;
  sync(access: string, body: SyncRequest): Promise<ApiResult<SyncResponse, SyncBadRequest>>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** How long a request may go unanswered (response and body) before it counts as `network`. */
export interface Timeouts {
  syncMs: number;
  authMs: number;
}

/** specs/plan.md, "Sync": a stuck request (Tailscale half-up) must not hold up sync or sign-out. */
export const DEFAULT_TIMEOUTS: Timeouts = { syncMs: 30_000, authMs: 15_000 };

/** `fetch` is injectable for tests; the API is same-origin (`/api/…`, proxied by Vite in dev). */
export function createApi(
  fetchFn: Fetch = (input, init) => fetch(input, init),
  base = '',
  timeouts: Timeouts = DEFAULT_TIMEOUTS,
): Api {
  async function post<T, Rejected = never>(
    path: string,
    body: unknown,
    timeoutMs: number,
    access?: string,
  ): Promise<ApiResult<T, Rejected>> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const result = await send<T, Rejected>(path, body, controller.signal, access);
      // Aborting mid-body makes the body unreadable, which `send` would call a server error.
      return controller.signal.aborted ? { kind: 'network' } : result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send<T, Rejected>(
    path: string,
    body: unknown,
    signal: AbortSignal,
    access?: string,
  ): Promise<ApiResult<T, Rejected>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (access !== undefined) headers.Authorization = `Bearer ${access}`;
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      return { kind: 'network' };
    }
    if (response.status === 429) return { kind: 'throttled' };
    if (response.status !== 200 && response.status !== 400 && response.status !== 401) {
      return { kind: 'server_error', status: response.status };
    }
    // Only a JSON body is the API's answer. Anything else (an HTML page from a proxy or the app
    // shell while no API is deployed) is a server problem, never a refused login or push.
    const json = await readJson(response);
    if (json === NOT_JSON) return { kind: 'server_error', status: response.status };
    if (response.status === 200) return { kind: 'ok', body: json as T };
    if (response.status === 400) return { kind: 'rejected', body: json as Rejected };
    return { kind: 'unauthorized' };
  }

  return {
    login: (credentials) => post('/api/auth/token/', credentials, timeouts.authMs),
    refresh: (refreshToken) =>
      post('/api/auth/token/refresh/', { refresh: refreshToken }, timeouts.authMs),
    sync: (access, body) => post('/api/sync/', body, timeouts.syncMs, access),
  };
}

const NOT_JSON = Symbol('not JSON');

/**
 * The one unchecked step: the body is the shape the OpenAPI schema documents for this status
 * (cast by the caller). The schema and `api.gen.ts` are generated from the server code and
 * checked for drift in CI.
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = JSON.parse(await response.text());
    return body !== null && typeof body === 'object' ? body : NOT_JSON;
  } catch {
    return NOT_JSON;
  }
}
