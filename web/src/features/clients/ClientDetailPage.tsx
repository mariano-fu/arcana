import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { db, repos, type Client } from '../../db';
import DeleteClientDialog from './DeleteClientDialog';
import { deleteClient } from './deletion';
import { formatDate } from './format';
import { useClient } from './hooks';

export default function ClientDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const client = useClient(id);

  if (client === undefined) return null;
  if (client === null) return <p className="py-8 text-center">{t('common.notFound')}</p>;
  return <ClientDetail client={client} />;
}

function ClientDetail({ client }: { client: Client }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function setArchived(archived: boolean) {
    await repos.client.update(client.id, { archived });
  }

  const contact = [
    client.instagram !== null && `@${client.instagram}`,
    client.whatsapp,
    client.email,
  ].filter((value): value is string => typeof value === 'string');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link
          to="/clients"
          className="flex min-h-11 items-center self-start text-base text-stone-600"
        >
          ← {t('common.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        {client.archived && (
          <span className="self-start rounded-full bg-stone-200 px-3 py-1 text-sm">
            {t('clients.archivedBadge')}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Link to={`/clients/${client.id}/edit`} className={actionClass}>
            {t('common.edit')}
          </Link>
          <button
            type="button"
            onClick={() => void setArchived(!client.archived)}
            className={actionClass}
          >
            {client.archived ? t('clients.detail.unarchive') : t('clients.detail.archive')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(true);
            }}
            className={`${actionClass} text-red-700`}
          >
            {t('clients.detail.delete')}
          </button>
        </div>
      </header>

      <Section title={t('clients.detail.contact')}>
        {contact.length === 0 ? (
          <p className="text-stone-600">{t('clients.detail.noContact')}</p>
        ) : (
          <ul>
            {contact.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* Without a birth date, the astrology section below asks for one. */}
      {client.birth_date !== null && (
        <Section title={t('clients.detail.birth')}>
          <p>
            {[
              formatDate(client.birth_date),
              client.birth_time ?? t('clients.detail.birthTimeUnknown'),
              client.birth_place_label,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
        </Section>
      )}

      {client.tags.length > 0 && (
        <Section title={t('clients.detail.tags')}>
          <ul className="flex flex-wrap gap-2">
            {client.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-stone-200 px-3 py-1 text-sm">
                {tag}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {client.notes !== '' && (
        <Section title={t('clients.detail.notes')}>
          <p className="whitespace-pre-wrap">{client.notes}</p>
        </Section>
      )}

      {/* Shells filled by later tasks: astrology (T2.6), crystals (T2.9), sessions (T1.8). */}
      <Section title={t('clients.detail.astrology')}>
        <p className="text-stone-600">
          {client.birth_date === null
            ? t('clients.detail.astrologyMissingBirthDate')
            : t('clients.detail.astrologySoon')}
        </p>
      </Section>
      <Section title={t('clients.detail.crystals')}>
        <p className="text-stone-600">{t('clients.detail.crystalsSoon')}</p>
      </Section>
      <Section title={t('clients.detail.sessions')}>
        <p className="text-stone-600">{t('clients.detail.noSessions')}</p>
      </Section>

      {confirmingDelete && (
        <DeleteClientDialog
          client={client}
          onArchive={() => {
            setConfirmingDelete(false);
            void setArchived(true);
          }}
          onDelete={() => {
            void deleteClient(db, client.id).then(() => navigate('/clients', { replace: true }));
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        />
      )}
    </div>
  );
}

const actionClass =
  'flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-base';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-base">{children}</div>
    </section>
  );
}
