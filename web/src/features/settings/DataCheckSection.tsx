import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';

import { db } from '../../db';
import { dataSummary, type DataCounts } from './dataCheck';
import SettingsSection from './SettingsSection';
import { formatBuildDate } from './versions';

const COUNTS: (keyof DataCounts)[] = [
  'clients',
  'sessions',
  'payments',
  'readings',
  'cardDraws',
  'cardNotes',
  'ownSpreads',
  'ownCrystals',
];

/** What's stored on this phone, read-only, for her to screenshot a week apart (T1.16). */
export default function DataCheckSection() {
  const { t } = useTranslation();
  const summary = useLiveQuery(() => dataSummary(db));
  const none = t('settings.dataCheck.none');
  const date = (value: Date | string | null) =>
    value === null ? none : formatBuildDate(new Date(value).toISOString());

  return (
    <SettingsSection title={t('settings.dataCheck.title')}>
      {summary && (
        <ul className="flex flex-col gap-1 text-base">
          <li>
            {t('settings.dataCheck.phone', {
              id: summary.phone?.short ?? none,
              since: date(summary.phone?.since ?? null),
            })}
          </li>
          {COUNTS.map((key) => (
            <li key={key}>{t(`settings.dataCheck.counts.${key}`, { n: summary.counts[key] })}</li>
          ))}
          <li>
            {t('settings.dataCheck.oldestClient', { date: date(summary.oldestClientCreatedAt) })}
          </li>
          <li>
            {t('settings.dataCheck.oldestSession', { date: date(summary.oldestSessionStartedAt) })}
          </li>
        </ul>
      )}
      <p className="text-sm text-stone-600">{t('settings.dataCheck.explain')}</p>
    </SettingsSection>
  );
}
