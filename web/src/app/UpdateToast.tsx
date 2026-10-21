import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { flushAllAutosaves } from '../features/sessions/autosave';
import { watchForUpdates } from './updates';

/**
 * Registers the service worker and, when a new version is waiting, offers to reload into it
 * (T4.7). It never reloads by itself: only a tap on "Recargar" does, after every autosaved
 * field has been stored; if a save failed it doesn't reload (Provisional T4.7 U5). "Ahora no"
 * hides it until the next start, when the new version takes over on a cold start (Provisional
 * T4.7 U1). Forms with an explicit "Guardar" are not saved first (Provisional T4.7 U3): the
 * reload only happens when she taps.
 */
export default function UpdateToast() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // For the app's lifetime: the toast is mounted once, above the router.
      if (registration) watchForUpdates(registration);
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
    },
  });

  if (!needRefresh || dismissed) return null;

  async function reload() {
    setReloading(true);
    setSaveFailed(false);
    if (!(await flushAllAutosaves())) {
      setSaveFailed(true);
      setReloading(false);
      return;
    }
    await updateServiceWorker(true);
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2 rounded-lg bg-stone-900 p-3 text-base text-stone-50 shadow-lg">
        <p>{saveFailed ? t('app.update.saveFailed') : t('app.update.available')}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
            }}
            className="min-h-11 rounded-lg px-4"
          >
            {t('app.update.later')}
          </button>
          <button
            type="button"
            disabled={reloading}
            onClick={() => void reload()}
            className="min-h-11 rounded-lg bg-stone-50 px-4 font-medium text-stone-900 disabled:opacity-60"
          >
            {t('app.update.reload')}
          </button>
        </div>
      </div>
    </div>
  );
}
