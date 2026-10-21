import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from './SettingsSection';

// The licence texts are ~50 kB; they load only when she opens the list (still precached).
const LicenseList = lazy(() => import('./LicenseList'));

const linkClass = 'flex min-h-11 items-center text-base underline';

/** "Acerca de": what Arcana is, data and image credits, and third-party licences. */
export default function AboutSection() {
  const { t } = useTranslation();
  const [showLicenses, setShowLicenses] = useState(false);

  return (
    <SettingsSection title={t('about.title')}>
      <p className="text-base">{t('app.description')}</p>

      <h3 className="text-base font-semibold">{t('about.creditsTitle')}</h3>
      <p className="text-base">{t('about.cardImages')}</p>
      {/* GeoNames requires attribution with links to the source and the licence. */}
      <p className="text-base">{t('about.geonames')}</p>
      <ul className="flex flex-col">
        <li>
          <a href="https://www.geonames.org/" className={linkClass}>
            {t('about.geonamesLink')}
          </a>
        </li>
        <li>
          <a href="https://creativecommons.org/licenses/by/4.0/" className={linkClass}>
            {t('about.licenseLink')}
          </a>
        </li>
      </ul>

      <h3 className="text-base font-semibold">{t('about.licensesTitle')}</h3>
      <p className="text-base">{t('about.licensesIntro')}</p>
      {showLicenses ? (
        <Suspense fallback={<p className="text-base text-stone-600">{t('about.loading')}</p>}>
          <LicenseList />
        </Suspense>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowLicenses(true);
          }}
          className="min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base"
        >
          {t('about.licensesShow')}
        </button>
      )}
    </SettingsSection>
  );
}
