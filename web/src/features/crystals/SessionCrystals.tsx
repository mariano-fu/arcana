import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { db, type Client } from '../../db';
import { attachCrystal, detachCrystal } from './actions';
import CrystalRecommendations from './CrystalRecommendations';
import { useSessionCrystals, type AttachedCrystal } from './hooks';

/**
 * The session page's "Cristales" section: the crystals attached to the session, each with
 * "Quitar", then the client's recommendations with "Agregar a la sesión".
 */
export default function SessionCrystals({
  sessionId,
  client,
}: {
  sessionId: string;
  client: Client;
}) {
  const { t } = useTranslation();
  const attached = useSessionCrystals(sessionId);
  const attachedIds = useMemo(
    () => new Set((attached ?? []).map(({ crystal }) => crystal.id)),
    [attached],
  );

  function attach(crystalId: string) {
    attachCrystal(db, sessionId, crystalId).catch((error: unknown) => {
      console.error('Attaching a crystal failed', error);
    });
  }

  function detach(crystalId: string) {
    detachCrystal(db, sessionId, crystalId).catch((error: unknown) => {
      console.error('Removing a crystal failed', error);
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('crystals.session.title')}</h2>
      {attached?.length === 0 && (
        <p className="text-base text-stone-600">{t('crystals.session.empty')}</p>
      )}
      {attached && attached.length > 0 && (
        <ul className="flex flex-col divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {attached.map((item) => (
            <li
              key={item.attachment.id}
              className="flex min-h-11 items-center justify-between gap-2 px-3 py-1"
            >
              <span className="text-base font-medium">{attachedName(item, t)}</span>
              <button
                type="button"
                aria-label={t('crystals.session.removeLabel', { name: item.crystal.name })}
                onClick={() => {
                  detach(item.crystal.id);
                }}
                className="flex min-h-11 items-center px-2 text-base text-stone-600"
              >
                {t('crystals.session.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-2 text-base font-semibold">{t('crystals.session.recommended')}</h3>
      <div className="text-base">
        <CrystalRecommendations client={client} attach={{ attachedIds, onAttach: attach }} />
      </div>
    </section>
  );
}

/** Its current name, labelled when it was deleted or hidden since (T2.9 Q2, Q4). */
function attachedName({ crystal }: AttachedCrystal, t: TFunction): string {
  if (crystal.deleted_at !== null) return `${crystal.name} ${t('crystals.session.deleted')}`;
  if (crystal.hidden) return `${crystal.name} ${t('crystals.session.hidden')}`;
  return crystal.name;
}
