import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useReviewCount } from './hooks';

/** On Inicio, only while something needs her: conflicts or sessions of a deleted ficha. */
export default function ReviewCard() {
  const { t } = useTranslation();
  const count = useReviewCount();
  if (count === 0) return null;

  return (
    <section
      aria-labelledby="review-card-title"
      className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex flex-col">
        <h2 id="review-card-title" className="text-base font-semibold">
          {t('conflicts.inicio.title')}
        </h2>
        <p className="text-sm">{t('conflicts.inicio.count', { count })}</p>
      </div>
      <Link
        to="/conflicts"
        className="flex min-h-11 items-center rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50"
      >
        {t('conflicts.inicio.action')}
      </Link>
    </section>
  );
}
