import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatDay } from './format';
import { useClientList } from './hooks';
import { matchesQuery, sortByLastActivity } from './list';

export default function ClientListPage() {
  const { t } = useTranslation();
  const items = useClientList();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const visible = sortByLastActivity(
    (items ?? []).filter(
      ({ client }) => (showArchived || !client.archived) && matchesQuery(client, query),
    ),
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('clients.title')}</h1>
        <Link
          to="/clients/new"
          className="flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-base font-medium text-stone-50"
        >
          {t('clients.add')}
        </Link>
      </header>

      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        aria-label={t('clients.search.label')}
        placeholder={t('clients.search.placeholder')}
        className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base"
      />

      <label className="flex min-h-11 items-center gap-3 text-base text-stone-700">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => {
            setShowArchived(event.target.checked);
          }}
          className="size-5"
        />
        {t('clients.showArchived')}
      </label>

      {items === undefined ? null : visible.length === 0 ? (
        <p className="py-8 text-center text-stone-600">
          {query.trim() === '' ? t('clients.empty') : t('clients.noResults', { query })}
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {visible.map(({ client, lastVisit }) => (
            <li key={client.id}>
              <Link
                to={`/clients/${client.id}`}
                className="flex min-h-14 flex-col justify-center px-4 py-2"
              >
                <span className="text-base font-medium">
                  {client.name}
                  {client.archived && (
                    <span className="ml-2 text-sm font-normal text-stone-500">
                      {t('clients.archivedBadge')}
                    </span>
                  )}
                </span>
                <span className="text-sm text-stone-600">
                  {client.instagram !== null && `@${client.instagram} · `}
                  {lastVisit === null
                    ? t('clients.noVisits')
                    : t('clients.lastVisit', { date: formatDay(lastVisit) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
