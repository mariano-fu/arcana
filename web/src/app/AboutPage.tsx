import { useTranslation } from 'react-i18next';

/** "Acerca de": app description and third-party data credits (GeoNames requires attribution). */
export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('about.title')}</h1>
      <p>{t('app.description')}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('about.creditsTitle')}</h2>
        <p>{t('about.geonames')}</p>
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
      </section>
    </div>
  );
}

const linkClass = 'flex min-h-11 items-center text-base underline';
