import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArcanaDB, createRepositories } from '../../db';
import es from '../../i18n/locales/es.json';
import { createSyncEngine, type SyncEngine } from '../../sync';
import { createApi, type Api } from '../../sync/api';
import { createLocalLocks } from '../../sync/locks';
import {
  EPOCH_KEY,
  INITIAL_STATUS,
  readStatus,
  writeStatus,
  type SyncStatus,
} from '../../sync/status';
import { FakeSyncServer } from '../../test/fakeSyncServer';
import { newClient } from '../clients/test-utils';
import { formatDateTime } from '../sessions/format';
import SyncSection from './SyncSection';

const S = es.settings.sync;
const HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

let db: ArcanaDB;
let server: FakeSyncServer;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  server = new FakeSyncServer();
});

afterEach(async () => {
  await db.delete();
});

function engineOn(api: Api): SyncEngine {
  return createSyncEngine({ db, api, locks: createLocalLocks() });
}

function show(engine: SyncEngine = engineOn(server)) {
  render(<SyncSection engine={engine} db={db} />);
  return within(screen.getByRole('region', { name: S.title }));
}

async function signIn(status: Partial<SyncStatus> = {}) {
  await db.auth.put({ key: 'tokens', ...server.issueTokens() });
  await writeStatus(db, { ...INITIAL_STATUS, ...status });
}

function fetchReturning(status: number, body: string) {
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(body, { status })),
  );
}

async function submitLogin(section: ReturnType<typeof show>) {
  const user = userEvent.setup();
  await user.click(await section.findByRole('button', { name: S.signIn }));
  await user.type(section.getByLabelText(S.username), 'lectora');
  await user.type(section.getByLabelText(S.password), 'secreta');
  await user.click(section.getByRole('button', { name: S.submit }));
}

describe('Sincronización, signed out', () => {
  it('is one neutral line and a button: no form, no warning, no request', async () => {
    const fetchFn = fetchReturning(200, '{}');
    const section = show(engineOn(createApi(fetchFn)));

    expect(await section.findByText(S.optional)).toBeVisible();
    expect(section.getByRole('button', { name: S.signIn })).toBeVisible();
    expect(section.queryByLabelText(S.password)).not.toBeInTheDocument();
    expect(section.queryByRole('alert')).not.toBeInTheDocument();
    expect(section.queryByRole('button', { name: es.sync.now })).not.toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never shows a stored clock skew', async () => {
    await writeStatus(db, { ...INITIAL_STATUS, state: 'signed_out', clock_skew_ms: 10 * 60_000 });
    const section = show();

    await section.findByText(S.optional);
    expect(section.queryByText(/atrasada|adelantada/)).not.toBeInTheDocument();
  });

  it('opens the form on tap and closes it on Cancelar', async () => {
    const user = userEvent.setup();
    const section = show();

    await user.click(await section.findByRole('button', { name: S.signIn }));
    expect(section.getByLabelText(S.username)).toHaveAttribute('autocomplete', 'username');
    expect(section.getByLabelText(S.password)).toHaveAttribute('type', 'password');
    expect(section.getByText(S.merge)).toBeVisible();

    await user.click(section.getByRole('button', { name: S.cancel }));
    expect(section.queryByLabelText(S.password)).not.toBeInTheDocument();
  });

  it('logs in, syncs once and switches to the signed-in view', async () => {
    const section = show();

    await submitLogin(section);

    expect(await section.findByText(S.signedIn)).toBeVisible();
    await waitFor(() => {
      expect(server.requests.length).toBeGreaterThan(0);
    });
    const status = await readStatus(db);
    expect(status.state).toBe('idle');
    expect(
      await section.findByText(
        S.lastSync.replace('{{date}}', formatDateTime(status.last_success ?? '')),
      ),
    ).toBeVisible();
    expect(JSON.stringify(await db.auth.toArray())).not.toContain('secreta');
  });

  it('says the credentials are wrong only for a JSON 401 from the API, and clears the password', async () => {
    const fetchFn = fetchReturning(401, '{"detail":"No active account found"}');
    const section = show(engineOn(createApi(fetchFn)));

    await submitLogin(section);

    expect(await section.findByRole('alert')).toHaveTextContent(S.error.invalid);
    expect(section.getByLabelText(S.password)).toHaveValue('');
    expect(section.getByLabelText(S.username)).toHaveValue('lectora');
    expect(await db.auth.count()).toBe(0);
  });

  it.each([
    ['a 404', 404, '{"detail":"Not found."}'],
    ['an HTML 404', 404, HTML],
    ['an HTML 200', 200, HTML],
    ['a 502', 502, 'Bad Gateway'],
  ])('says the server is unreachable for %s, never wrong credentials', async (_, status, body) => {
    const section = show(engineOn(createApi(fetchReturning(status, body))));

    await submitLogin(section);

    const alert = await section.findByRole('alert');
    expect(alert).toHaveTextContent(S.error.unavailable);
    expect(alert).not.toHaveTextContent(S.error.invalid);
    expect(await db.auth.count()).toBe(0);
  });

  it('says the server is unreachable when the login request times out, never wrong credentials', async () => {
    // No answer until aborted, as with Tailscale half-up.
    const fetchFn = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const section = show(engineOn(createApi(fetchFn, '', { syncMs: 50, authMs: 50 })));

    await submitLogin(section);

    const alert = await section.findByRole('alert');
    expect(alert).toHaveTextContent(S.error.unavailable);
    expect(alert).not.toHaveTextContent(S.error.invalid);
    expect(fetchFn.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(await db.auth.count()).toBe(0);
  });

  it('asks her to wait when throttled', async () => {
    const section = show(engineOn(createApi(fetchReturning(429, '{}'))));

    await submitLogin(section);

    expect(await section.findByRole('alert')).toHaveTextContent(S.error.throttled);
  });
});

describe('Sincronización, signed in', () => {
  it('before the first sync, says everything will be sent instead of a count', async () => {
    await signIn();
    await createRepositories(db).client.create(newClient());
    const section = show();

    expect(await section.findByText(S.signedIn)).toBeVisible();
    expect(section.getByText(S.never)).toBeVisible();
    expect(await section.findByText(S.firstSync)).toBeVisible();
    expect(section.queryByText(/Cambios sin enviar/)).toBeNull();
  });

  it('counts the changes not yet sent, tombstones included', async () => {
    await signIn();
    await db.meta.put({ key: EPOCH_KEY, value: 'epoch-1' });
    const repos = createRepositories(db);
    await repos.client.create(newClient());
    const deleted = await repos.client.create(newClient({ name: 'Otra' }));
    await repos.client.remove(deleted.id);
    const section = show();

    expect(await section.findByText('Cambios sin enviar: 2')).toBeVisible();
  });

  it('shows the count once a response stored an epoch, even if the run then failed', async () => {
    await signIn({ state: 'error' });
    await db.meta.put({ key: EPOCH_KEY, value: 'epoch-1' });
    const section = show();

    expect(await section.findByText('Cambios sin enviar: 0')).toBeVisible();
    expect(section.getByText(S.never)).toBeVisible();
    expect(section.queryByText(S.firstSync)).toBeNull();
  });

  it('shows the last sync and the offline state', async () => {
    const lastSuccess = '2026-10-24T20:32:00.000Z';
    await signIn({ state: 'offline', last_success: lastSuccess });
    const section = show();

    expect(
      await section.findByText(S.lastSync.replace('{{date}}', formatDateTime(lastSuccess))),
    ).toBeVisible();
    expect(section.getByText(S.state.offline)).toBeVisible();
  });

  it('warns about clock skew above 2 minutes, with its direction', async () => {
    await signIn({ clock_skew_ms: 5 * 60_000 });
    const section = show();

    expect(await section.findByRole('alert')).toHaveTextContent(
      S.skew.behind.replace('{{minutes}}', '5'),
    );
  });

  it('warns when the phone is ahead', async () => {
    await signIn({ clock_skew_ms: -3 * 60_000 - 1 });
    const section = show();

    expect(await section.findByRole('alert')).toHaveTextContent(
      S.skew.ahead.replace('{{minutes}}', '3'),
    );
  });

  it('stays quiet at 2 minutes of skew', async () => {
    await signIn({ clock_skew_ms: 2 * 60_000 });
    const section = show();

    await section.findByText(S.signedIn);
    expect(section.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Sincronizar" runs a manual sync and is disabled while it runs', async () => {
    const user = userEvent.setup();
    await signIn();
    const engine = engineOn(server);
    const sync = vi.spyOn(engine, 'sync');
    const release = server.hold();
    const section = show(engine);

    await user.click(await section.findByRole('button', { name: es.sync.now }));
    expect(sync).toHaveBeenCalledWith('manual');
    expect(await section.findByRole('button', { name: es.sync.syncing })).toBeDisabled();

    release();
    expect(await section.findByRole('button', { name: es.sync.now })).toBeEnabled();
    expect(await section.findByText(/Última sincronización/)).toBeVisible();
  });

  it('"Cerrar sesión" during a run waits for it, saying so, then keeps the data and signs out', async () => {
    const user = userEvent.setup();
    await signIn({ clock_skew_ms: 10 * 60_000 });
    const client = await createRepositories(db).client.create(newClient());
    const engine = engineOn(server);
    const release = server.hold();
    const run = engine.sync('manual');
    const section = show(engine);

    expect(await section.findByText(S.signOutNote)).toBeVisible();
    await user.click(await section.findByRole('button', { name: S.signOut }));

    expect(await section.findByRole('button', { name: S.signingOut })).toBeDisabled();
    expect(await db.auth.count()).toBe(1);

    release();
    expect((await run).state).toBe('idle');
    expect(await section.findByText(S.optional)).toBeVisible();
    expect(await db.auth.count()).toBe(0);
    // The run it waited for finished its push; the row stays on the device.
    expect(server.get('client', client.id)).toBeDefined();
    expect(await db.client.get(client.id)).toMatchObject({ name: client.name, deleted_at: null });
    const status = await readStatus(db);
    expect(status.state).toBe('signed_out');
    expect(status.clock_skew_ms).toBeNull();
  });
});
