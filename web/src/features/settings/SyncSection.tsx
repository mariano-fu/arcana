import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { db as appDb, type ArcanaDB } from '../../db';
import { countPending, readStatus, syncEngine, type SyncEngine } from '../../sync';
import type { LoginOutcome } from '../../sync/auth';
import { formatDateTime } from '../sessions/format';
import SettingsSection from './SettingsSection';
import { skewWarning } from './syncInfo';

const buttonClass =
  'min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base disabled:opacity-60';
const inputClass = 'min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base';

export interface SyncSectionProps {
  engine?: SyncEngine;
  db?: ArcanaDB;
}

/**
 * Sincronización (T3.8). Sync is optional: signed out, this is one neutral line and a button
 * that opens the login form. Nothing here or elsewhere prompts her to log in, and nothing
 * contacts the API until she does. The problems she must act on (detenida, fecha futura, sesión
 * expirada) are in `SyncBanner`, so they aren't repeated here.
 */
export default function SyncSection({ engine = syncEngine, db = appDb }: SyncSectionProps) {
  const { t } = useTranslation();
  // Signed in = tokens stored. The status can lag behind (it is written by the next run).
  const signedIn = useLiveQuery(async () => (await db.auth.count()) > 0, [db]);

  return (
    <SettingsSection title={t('settings.sync.title')}>
      {signedIn === undefined ? null : signedIn ? (
        <SignedIn engine={engine} db={db} />
      ) : (
        <SignedOut engine={engine} />
      )}
    </SettingsSection>
  );
}

function SignedOut({ engine }: { engine: SyncEngine }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <>
        <p className="text-base">{t('settings.sync.optional')}</p>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className={buttonClass}
        >
          {t('settings.sync.signIn')}
        </button>
      </>
    );
  }
  return (
    <LoginForm
      engine={engine}
      onCancel={() => {
        setOpen(false);
      }}
    />
  );
}

const LOGIN_ERRORS = {
  invalid: 'settings.sync.error.invalid',
  throttled: 'settings.sync.error.throttled',
  unavailable: 'settings.sync.error.unavailable',
} as const satisfies Record<Exclude<LoginOutcome, 'ok'>, string>;

function LoginForm({ engine, onCancel }: { engine: SyncEngine; onCancel: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Exclude<LoginOutcome, 'ok'> | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const outcome = await engine.auth.login({ username: username.trim(), password });
    // The password is never kept, not even in the form.
    setPassword('');
    setBusy(false);
    if (outcome === 'ok') {
      // The form unmounts: the section switches to the signed-in view.
      void engine.sync('manual');
      return;
    }
    setError(outcome);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-base">
        {t('settings.sync.username')}
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-base">
        {t('settings.sync.password')}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          className={inputClass}
        />
      </label>
      <p className="text-sm text-stone-600">{t('settings.sync.merge')}</p>
      {error && (
        <p role="alert" className="text-base text-red-700">
          {t(LOGIN_ERRORS[error])}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50 disabled:opacity-60"
        >
          {busy ? t('settings.sync.signingIn') : t('settings.sync.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
          {t('settings.sync.cancel')}
        </button>
      </div>
    </form>
  );
}

function SignedIn({ engine, db }: { engine: SyncEngine; db: ArcanaDB }) {
  const { t } = useTranslation();
  const status = useLiveQuery(() => readStatus(db), [db]);
  const pending = useLiveQuery(() => countPending(db), [db]);
  const syncing = useSyncExternalStore(engine.subscribe, engine.isSyncing);
  const [signingOut, setSigningOut] = useState(false);

  if (!status) return null;
  const skew = skewWarning(status.clock_skew_ms);

  return (
    <>
      <p className="text-base font-medium">{t('settings.sync.signedIn')}</p>
      <p aria-live="polite" className="text-base">
        {status.last_success === null
          ? t('settings.sync.never')
          : t('settings.sync.lastSync', { date: formatDateTime(status.last_success) })}
      </p>
      {(status.state === 'offline' || status.state === 'error') && (
        <p className="text-base text-stone-700">{t(`settings.sync.state.${status.state}`)}</p>
      )}
      {pending !== undefined && (
        <p className="text-base text-stone-700">{t('settings.sync.pending', { count: pending })}</p>
      )}
      {skew && (
        <p role="alert" className="rounded-lg bg-amber-100 p-3 text-base text-amber-950">
          {t(`settings.sync.skew.${skew.direction}`, { minutes: skew.minutes })}
        </p>
      )}
      <button
        type="button"
        disabled={syncing}
        onClick={() => void engine.sync('manual')}
        className="min-h-11 self-start rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50 disabled:opacity-60"
      >
        {syncing ? t('sync.syncing') : t('sync.now')}
      </button>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void engine.signOut().finally(() => {
            setSigningOut(false);
          });
        }}
        className={buttonClass}
      >
        {t('settings.sync.signOut')}
      </button>
      <p className="text-sm text-stone-600">{t('settings.sync.signOutNote')}</p>
    </>
  );
}
