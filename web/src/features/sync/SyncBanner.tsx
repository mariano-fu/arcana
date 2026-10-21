import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { db as appDb, type ArcanaDB } from '../../db';
import { readStatus, syncEngine, type SyncEngine, type SyncStatus } from '../../sync';

const ERROR_CODES = [
  'invalid',
  'server_owned',
  'clock_ahead',
  'constraint',
  'missing_parent',
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];
const isErrorCode = (code: string): code is ErrorCode =>
  ERROR_CODES.some((known) => known === code);

const MESSAGES = {
  stopped: 'sync.stopped',
  clock_ahead: 'sync.clockAhead',
  session_expired: 'sync.sessionExpired',
} as const;

type Shown = keyof typeof MESSAGES;
const isShown = (state: SyncStatus['state']): state is Shown => state in MESSAGES;

export interface SyncBannerProps {
  engine?: SyncEngine;
  db?: ArcanaDB;
}

/**
 * Shows sync problems she has to act on: a refused push ("detenida", with details), a device
 * clock ahead, an expired session. "Sincronizar" retries once per tap. Settings (T3.8) has the
 * rest: login, last sync, clock skew.
 */
export default function SyncBanner({ engine = syncEngine, db = appDb }: SyncBannerProps) {
  const { t } = useTranslation();
  const status = useLiveQuery(() => readStatus(db), [db]);
  const syncing = useSyncExternalStore(engine.subscribe, engine.isSyncing);

  if (!status || !isShown(status.state)) return null;
  const state = status.state;
  const messages = MESSAGES[state];

  return (
    <section
      role="alert"
      className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
    >
      <h2 className="text-base font-semibold">{t(`${messages}.title`)}</h2>
      <p className="text-sm">{t(`${messages}.body`)}</p>
      {state === 'stopped' && status.errors.length > 0 && (
        <details className="text-sm">
          <summary>{t('sync.stopped.details')}</summary>
          <ul className="mt-1 list-disc pl-5">
            {status.errors.map((error, index) => (
              <li key={index}>
                {isErrorCode(error.code) ? t(`sync.code.${error.code}`) : error.code}
                <span className="block font-mono text-xs break-all text-stone-600">
                  {[error.table, error.id, error.detail].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {state !== 'session_expired' && (
        <button
          type="button"
          disabled={syncing}
          onClick={() => void engine.sync('manual')}
          className="min-h-11 self-start rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50 disabled:opacity-60"
        >
          {syncing ? t('sync.syncing') : t('sync.now')}
        </button>
      )}
    </section>
  );
}
