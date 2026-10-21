import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArcanaDB } from '../../db';
import es from '../../i18n/locales/es.json';
import { INITIAL_STATUS, writeStatus, type SyncStatus } from '../../sync/status';
import type { SyncEngine } from '../../sync';
import SyncBanner from './SyncBanner';

let db: ArcanaDB;
let engine: SyncEngine;
let sync: ReturnType<typeof vi.fn<SyncEngine['sync']>>;

beforeEach(() => {
  db = new ArcanaDB(`test-${crypto.randomUUID()}`);
  sync = vi.fn<SyncEngine['sync']>(() => Promise.resolve(INITIAL_STATUS));
  engine = {
    auth: { getAccess: vi.fn(), login: vi.fn(), refreshAfter: vi.fn(), expire: vi.fn() },
    sync,
    isSyncing: () => false,
    subscribe: () => () => {},
  };
});

afterEach(async () => {
  await db.delete();
});

async function show(status: Partial<SyncStatus>) {
  await writeStatus(db, { ...INITIAL_STATUS, ...status });
  render(<SyncBanner engine={engine} db={db} />);
}

describe('SyncBanner', () => {
  it('shows nothing while sync is fine or just offline', async () => {
    await show({ state: 'offline' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says sync is stopped, with the details, and retries on "Sincronizar"', async () => {
    await show({
      state: 'stopped',
      errors: [{ table: 'client', id: 'c1', code: 'constraint', detail: 'duplicate key' }],
    });

    expect(await screen.findByText(es.sync.stopped.title)).toBeInTheDocument();
    expect(screen.getByText(es.sync.code.constraint)).toBeInTheDocument();
    expect(screen.getByText('client · c1 · duplicate key')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: es.sync.now }));
    expect(sync).toHaveBeenCalledWith('manual');
  });

  it('asks to check the phone clock on clock_ahead', async () => {
    await show({ state: 'clock_ahead' });

    expect(await screen.findByText(es.sync.clockAhead.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.sync.now })).toBeInTheDocument();
  });

  it('points to Settings when the session expired, without a retry button', async () => {
    await show({ state: 'session_expired' });

    expect(await screen.findByText(es.sync.sessionExpired.title)).toBeInTheDocument();
    expect(screen.getByText(es.sync.sessionExpired.body)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
