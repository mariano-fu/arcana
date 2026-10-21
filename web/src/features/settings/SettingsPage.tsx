import { useTranslation } from 'react-i18next';

import AboutSection from './AboutSection';
import StorageSection from './StorageSection';
import VersionsSection from './VersionsSection';

/** Ajustes. T3.8 adds its sync section (login, last sync, sync now) above these. */
export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <StorageSection />
      <VersionsSection />
      <AboutSection />
    </div>
  );
}
