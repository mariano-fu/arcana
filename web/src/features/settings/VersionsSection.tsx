import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';

import SettingsSection from './SettingsSection';
import { appBuild, dataVersions, formatBuildDate } from './versions';

/** App build and data versions, for her to read out when reporting a problem. */
export default function VersionsSection() {
  const { t } = useTranslation();
  const data = useLiveQuery(dataVersions);
  const loaded = (version: number | null) =>
    version === null ? t('settings.versions.notLoaded') : String(version);

  return (
    <SettingsSection title={t('settings.versions.title')}>
      <ul className="flex flex-col gap-1 text-base">
        <li>
          {t('settings.versions.app', {
            version: appBuild.version,
            commit: appBuild.commit,
            date: formatBuildDate(appBuild.builtAt),
          })}
        </li>
        {data && (
          <>
            <li>{t('settings.versions.schema', { schema: data.schema })}</li>
            <li>
              {t('settings.versions.content', {
                cards: data.cards,
                spreads: loaded(data.spreads),
                crystals: loaded(data.crystals),
              })}
            </li>
          </>
        )}
      </ul>
    </SettingsSection>
  );
}
