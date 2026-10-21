import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { db, type SpreadTemplate } from '../../db';
import { useSession } from '../sessions/hooks';
import { createReading } from './actions';
import { useSpreadTemplates } from './hooks';

/** "Nueva tirada": one tap on a spread creates the reading and opens it. */
export default function TemplatePickerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: sessionId } = useParams();
  const session = useSession(sessionId);
  const templates = useSpreadTemplates();
  const [busy, setBusy] = useState(false);

  if (session === undefined || templates === undefined) return null;
  if (session === null) return <p className="py-8 text-center">{t('common.notFound')}</p>;

  function choose(template: SpreadTemplate) {
    if (busy || !session) return;
    setBusy(true);
    createReading(db, session.id, template.id).then(
      (reading) => navigate(`/sessions/${session.id}/readings/${reading.id}`, { replace: true }),
      (error: unknown) => {
        console.error('Creating the reading failed', error);
        setBusy(false);
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          to={`/sessions/${session.id}`}
          className="flex min-h-11 items-center self-start text-base text-stone-600"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('spreads.chooser.title')}</h1>
      </header>

      {templates.length === 0 ? (
        <p className="text-base text-stone-600">{t('spreads.chooser.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  choose(template);
                }}
                className="flex min-h-14 w-full flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold">{template.name}</span>
                  <span className="shrink-0 text-sm text-stone-500">
                    {t('spreads.cardCount', { count: template.positions.length })}
                  </span>
                </span>
                {template.description !== '' && (
                  <span className="line-clamp-2 text-sm text-stone-600">
                    {template.description}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/sessions/${session.id}/spreads/new`}
          className="flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-base"
        >
          {t('spreads.chooser.create')}
        </Link>
        <Link
          to={`/sessions/${session.id}/spreads`}
          className="flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-base"
        >
          {t('spreads.chooser.manage')}
        </Link>
      </div>
    </div>
  );
}
