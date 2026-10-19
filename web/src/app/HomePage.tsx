import { useTranslation } from 'react-i18next';

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
      <p className="text-xl">{t('hello.title')}</p>
      <p className="max-w-sm text-base text-stone-600">{t('hello.subtitle')}</p>
    </div>
  );
}
