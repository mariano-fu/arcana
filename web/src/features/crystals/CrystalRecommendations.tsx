import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clientSigns } from '../../astro/clientSigns';
import { repos, type Client } from '../../db';
import { formatReasons, intentionLabel, recommendCrystals } from './recommend';

/** Shown at first and added per "Ver más" (T2.9 Q1). */
export const PAGE_SIZE = 5;

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/** Inside a session: which crystals are attached, and how to attach one. */
export interface AttachControls {
  attachedIds: ReadonlySet<string>;
  onAttach: (crystalId: string) => void;
}

/**
 * Crystals for the client's signs and the intentions she picks here. The picked intentions are
 * not saved (T2.9 Q2): they start empty every time the page opens. With `attach` (the session
 * page), each one has "Agregar a la sesión", or a disabled "En la sesión" once attached.
 */
export default function CrystalRecommendations({
  client,
  attach,
}: {
  client: Client;
  attach?: AttachControls;
}) {
  const { t } = useTranslation();
  const data = useLiveQuery(async () => {
    const [crystals, tags] = await Promise.all([repos.crystal.list(), repos.intention_tag.list()]);
    return { crystals, tags };
  });
  const [chosen, setChosen] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE_SIZE);

  const { birth_date, birth_time, birth_lat, birth_lng, birth_tz } = client;
  const signs = useMemo(
    () => clientSigns({ birth_date, birth_time, birth_lat, birth_lng, birth_tz }),
    [birth_date, birth_time, birth_lat, birth_lng, birth_tz],
  );
  const ranked = useMemo(
    () =>
      data === undefined
        ? []
        : recommendCrystals({
            crystals: data.crystals,
            signs,
            intentions: chosen,
            tags: data.tags,
          }),
    [data, signs, chosen],
  );

  if (data === undefined) return null;
  const { tags } = data;
  const options = tags
    .map((tag) => ({ key: tag.key, label: intentionLabel(tag.key, tags, t) }))
    .sort((a, b) => collator.compare(a.label, b.label));

  function toggle(key: string) {
    setChosen((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
    setShown(PAGE_SIZE);
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base text-stone-600">
          {t('crystals.recommend.intentions')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {options.map(({ key, label }) => {
            const pressed = chosen.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  toggle(key);
                }}
                className={`flex min-h-11 items-center rounded-full border px-4 text-base ${
                  pressed
                    ? 'border-stone-900 bg-stone-900 text-stone-50'
                    : 'border-stone-300 bg-white'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {signs.sun === null && chosen.length === 0 ? (
        <p className="text-stone-600">{t('crystals.recommend.empty')}</p>
      ) : ranked.length === 0 ? (
        <p className="text-stone-600">{t('crystals.recommend.noMatches')}</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {ranked.slice(0, shown).map(({ crystal, reasons }) => (
              <li
                key={crystal.id}
                className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3"
              >
                <div>
                  <p className="font-medium">{crystal.name}</p>
                  <p className="text-stone-600">{formatReasons(reasons, tags, t)}</p>
                </div>
                {attach &&
                  (attach.attachedIds.has(crystal.id) ? (
                    <button
                      type="button"
                      disabled
                      aria-label={t('crystals.session.addedLabel', { name: crystal.name })}
                      className="flex min-h-11 items-center self-start rounded-lg border border-stone-200 bg-stone-100 px-4 text-base text-stone-400"
                    >
                      {t('crystals.session.added')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('crystals.session.addLabel', { name: crystal.name })}
                      onClick={() => {
                        attach.onAttach(crystal.id);
                      }}
                      className="flex min-h-11 items-center self-start rounded-lg border border-stone-300 bg-white px-4 text-base"
                    >
                      {t('crystals.session.add')}
                    </button>
                  ))}
              </li>
            ))}
          </ol>
          {ranked.length > shown && (
            <button
              type="button"
              onClick={() => {
                setShown((n) => n + PAGE_SIZE);
              }}
              className="flex min-h-11 items-center self-start rounded-lg border border-stone-300 bg-white px-4 text-base"
            >
              {t('crystals.recommend.more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
