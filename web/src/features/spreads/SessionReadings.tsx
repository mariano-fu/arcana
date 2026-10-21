import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useSessionReadings } from './hooks';

/** The session page's "Tiradas" section: its readings and "Nueva tirada". */
export default function SessionReadings({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const readings = useSessionReadings(sessionId);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('sessions.readings.title')}</h2>
      {readings?.length === 0 && (
        <p className="text-base text-stone-600">{t('sessions.readings.empty')}</p>
      )}
      {readings && readings.length > 0 && (
        <ul className="flex flex-col divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {readings.map(({ reading, placed }) => (
            <li key={reading.id}>
              <Link
                to={`/sessions/${sessionId}/readings/${reading.id}`}
                className="flex min-h-11 items-center justify-between gap-2 px-3 py-2"
              >
                <span className="text-base font-medium">{reading.spread_snapshot.name}</span>
                <span className="text-sm text-stone-600">
                  {t('sessions.readings.placed', {
                    placed,
                    total: reading.spread_snapshot.positions.length,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        to={`/sessions/${sessionId}/readings/new`}
        className="flex min-h-11 items-center justify-center self-start rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50"
      >
        {t('sessions.readings.new')}
      </Link>
    </section>
  );
}
