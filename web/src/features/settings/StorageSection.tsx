import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from './SettingsSection';
import {
  formatBytes,
  persistenceStatus,
  requestPersistence,
  storageEstimate,
  type PersistenceStatus,
  type StorageEstimate,
} from './storage';

/** Whether the browser keeps her data as persistent, and roughly how much space it takes. */
export default function StorageSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PersistenceStatus | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([persistenceStatus(), storageEstimate()]).then(([current, space]) => {
      if (cancelled) return;
      setStatus(current);
      setEstimate(space);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsSection title={t('settings.storage.title')}>
      <p aria-live="polite" className="text-base">
        {status === null
          ? t('settings.storage.checking')
          : status === 'unsupported'
            ? t('settings.storage.unsupported')
            : t('settings.storage.status', { status: t(`settings.storage.${status}`) })}
      </p>
      {status === 'not_persisted' && (
        <>
          <p className="rounded-lg bg-amber-100 p-3 text-base text-amber-950">
            {t('settings.storage.backup')}
          </p>
          <button
            type="button"
            onClick={() => {
              void requestPersistence().then(setStatus);
            }}
            className="min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base"
          >
            {t('settings.storage.retry')}
          </button>
        </>
      )}
      {estimate && (
        <p className="text-base text-stone-700">
          {t('settings.storage.usage', {
            usage: formatBytes(estimate.usage),
            quota: formatBytes(estimate.quota),
          })}
        </p>
      )}
      <p className="text-sm text-stone-600">{t('settings.storage.explain')}</p>
    </SettingsSection>
  );
}
