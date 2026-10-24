import { useTranslation } from 'react-i18next';

import AboutSection from './AboutSection';
import BackupSection from './BackupSection';
import DataCheckSection from './DataCheckSection';
import StorageSection from './StorageSection';
import SyncSection from './SyncSection';
import VersionsSection from './VersionsSection';

/** Ajustes. Sincronización sits below Respaldo, so a login form is never the first thing she sees. */
export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
      <StorageSection />
      <DataCheckSection />
      <BackupSection />
      <SyncSection />
      <VersionsSection />
      <AboutSection />
    </div>
  );
}
