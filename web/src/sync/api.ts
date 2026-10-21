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

/** `fetch` is injectable for tests; the API is same-origin (`/api/…`, proxied by Vite in dev). */
export function createApi(fetchFn: Fetch = (input, init) => fetch(input, init), base = ''): Api {
  async function post<T, Rejected = never>(
    path: string,
    body: unknown,
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
      });
    } catch {
      return { kind: 'network' };
    }
    if (response.status === 200) return { kind: 'ok', body: await readJson<T>(response) };
    if (response.status === 400)
      return { kind: 'rejected', body: await readJson<Rejected>(response) };
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 429) return { kind: 'throttled' };
    return { kind: 'server_error', status: response.status };
  }

  return {
    login: (credentials) => post('/api/auth/token/', credentials),
    refresh: (refreshToken) => post('/api/auth/token/refresh/', { refresh: refreshToken }),
    sync: (access, body) => post('/api/sync/', body, access),
  };
}

/**
 * The one unchecked step: the body is the shape the OpenAPI schema documents for this status.
 * The schema and `api.gen.ts` are generated from the server code and checked for drift in CI.
 */
async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
