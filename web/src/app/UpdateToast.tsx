import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { hasUnsavedForms } from '../features/forms/unsaved';
import { flushAllAutosaves } from '../features/sessions/autosave';
import { watchForUpdates } from './updates';

/**
 * Registers the service worker and, when a new version is waiting, offers to reload into it
 * (T4.7). It never reloads by itself: only a tap on "Recargar" does, after every autosaved
 * field has been stored; if a save failed it doesn't reload (T4.7 U5). "Ahora no"
 * hides it until the next start, when the new version takes over on a cold start (T4.7 U1).
 * Forms with an explicit "Guardar" are not saved for her: when one has unsaved edits it asks
 * first, and "Volver al formulario" keeps the page as it is (T4.7 U3).
 */
export default function UpdateToast() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmingUnsaved, setConfirmingUnsaved] = useState(false);
  const unsavedId = useId();
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

  async function reload({ discardForms }: { discardForms: boolean }) {
    setReloading(true);
    setSaveFailed(false);
    setConfirmingUnsaved(false);
    if (!(await flushAllAutosaves())) {
      setSaveFailed(true);
      setReloading(false);
      return;
    }
    if (!discardForms && hasUnsavedForms()) {
      setConfirmingUnsaved(true);
      setReloading(false);
      return;
    }
    await updateServiceWorker(true);
  }

  if (confirmingUnsaved) {
    return (
      <Toast role="alertdialog" labelledBy={unsavedId}>
        <p id={unsavedId}>{t('app.update.unsaved.body')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void reload({ discardForms: true })}
            className="min-h-11 rounded-lg px-4"
          >
            {t('app.update.unsaved.reloadAnyway')}
          </button>
          <button
            type="button"
            // The default: she's most likely in the middle of filling the form in.
            autoFocus
            onClick={() => {
              setConfirmingUnsaved(false);
            }}
            className="min-h-11 rounded-lg bg-stone-50 px-4 font-medium text-stone-900"
          >
            {t('app.update.unsaved.back')}
          </button>
        </div>
      </Toast>
    );
  }

  return (
    <Toast role="status">
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
          onClick={() => void reload({ discardForms: false })}
          className="min-h-11 rounded-lg bg-stone-50 px-4 font-medium text-stone-900 disabled:opacity-60"
        >
          {t('app.update.reload')}
        </button>
      </div>
    </Toast>
  );
}

function Toast({
  role,
  labelledBy,
  children,
}: {
  role: 'status' | 'alertdialog';
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-labelledby={labelledBy}
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2 rounded-lg bg-stone-900 p-3 text-base text-stone-50 shadow-lg">
        {children}
      </div>
    </div>
  );
}
