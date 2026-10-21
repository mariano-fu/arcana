import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { db, type SpreadTemplate } from '../../../db';
import { useSession } from '../../sessions/hooks';
import { useSpreadTemplates } from '../hooks';
import { duplicateSpread } from './actions';

/**
 * "Mis tiradas" (`/sessions/:id/spreads`), reached from the session's "Nueva tirada" chooser:
 * the included spreads, which she can only duplicate, and her own, which she can edit or
 * duplicate. "Duplicar" saves the copy right away and opens it in the editor.
 */
export default function SpreadListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const session = useSession(sessionId);
  const templates = useSpreadTemplates();
  const [busy, setBusy] = useState(false);

  if (session === undefined || templates === undefined) return null;
  if (session === null) return <p className="py-8 text-center">{t('common.notFound')}</p>;

  const base = `/sessions/${session.id}/spreads`;
  const seeds = templates.filter((template) => template.is_seed);
  const custom = templates.filter((template) => !template.is_seed);

  function duplicate(template: SpreadTemplate) {
    if (busy) return;
    setBusy(true);
    duplicateSpread(db, template.id, (name, n) =>
      n === 1
        ? t('spreads.builder.copyName', { name })
        : t('spreads.builder.copyNameN', { name, n }),
    ).then(
      (copy) => navigate(`${base}/${copy.id}/edit`),
      (error: unknown) => {
        console.error('Duplicating the spread failed', error);
        setBusy(false);
      },
    );
  }

  const row = (template: SpreadTemplate) => (
    <li key={template.id} className="flex items-center gap-2 px-3 py-1">
      {template.is_seed ? (
        <span className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
          <span className="text-base font-medium">{template.name}</span>
          <span className="text-sm text-stone-500">
            {t('spreads.cardCount', { count: template.positions.length })}
          </span>
        </span>
      ) : (
        <Link
          to={`${base}/${template.id}/edit`}
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center"
        >
          <span className="text-base font-medium">{template.name}</span>
          <span className="text-sm text-stone-500">
            {t('spreads.cardCount', { count: template.positions.length })}
          </span>
        </Link>
      )}
      <button
        type="button"
        disabled={busy}
        aria-label={t('spreads.builder.list.duplicateLabel', { name: template.name })}
        onClick={() => {
          duplicate(template);
        }}
        className="min-h-11 shrink-0 rounded-lg border border-stone-300 bg-white px-3 text-base"
      >
        {t('spreads.builder.list.duplicate')}
      </button>
    </li>
  );

  const listClass =
    'flex flex-col divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          to={`/sessions/${session.id}/readings/new`}
          className="flex min-h-11 items-center self-start text-base text-stone-600"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('spreads.builder.list.title')}</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('spreads.builder.list.custom')}</h2>
        {custom.length === 0 ? (
          <p className="text-base text-stone-600">{t('spreads.builder.list.empty')}</p>
        ) : (
          <ul className={listClass}>{custom.map(row)}</ul>
        )}
        <Link
          to={`${base}/new?from=list`}
          className="flex min-h-11 items-center justify-center self-start rounded-lg bg-stone-900 px-4 text-base text-stone-50"
        >
          {t('spreads.builder.list.create')}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('spreads.builder.list.seed')}</h2>
        <ul className={listClass}>{seeds.map(row)}</ul>
      </section>
    </div>
  );
}
