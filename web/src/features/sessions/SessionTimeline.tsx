import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatDate } from '../clients/format';
import { formatMoney } from '../payments';
import { formatDateTime } from './format';
import { useClientSessions } from './hooks';

/** The client's sessions, newest first; each opens the session page. */
export default function SessionTimeline({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const sessions = useClientSessions(clientId);

  if (sessions === undefined) return null;
  if (sessions.length === 0) {
    return <p className="text-stone-600">{t('clients.detail.noSessions')}</p>;
  }
  return (
    <ul aria-label={t('clients.detail.sessions')} className="flex flex-col gap-2">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            to={`/sessions/${session.id}`}
            className="flex min-h-11 flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3"
          >
            <span className="flex justify-between gap-3">
              <span className="font-medium">{formatDateTime(session.started_at)}</span>
              <span className="text-stone-700">
                {session.price_minor === null
                  ? t('sessions.timeline.noPrice')
                  : formatMoney(session.price_minor, session.currency)}
              </span>
            </span>
            <span className="text-sm text-stone-600">{t(`sessions.type.${session.type}`)}</span>
            {session.follow_up_date !== null && (
              <span className="text-sm text-stone-600">
                {t('sessions.timeline.followUp', { date: formatDate(session.follow_up_date) })}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
