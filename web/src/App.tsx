import { useTranslation } from 'react-i18next';

export default function App() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-50 px-6 text-center text-stone-900">
      <h1 className="text-4xl font-semibold tracking-tight">{t('app.name')}</h1>
      <p className="text-xl">{t('hello.title')}</p>
      <p className="max-w-sm text-base text-stone-600">{t('hello.subtitle')}</p>
    </main>
  );
}
