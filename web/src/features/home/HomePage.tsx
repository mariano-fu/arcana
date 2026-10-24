import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatDate } from '../clients/format';
import { CURRENCIES, formatMoney, paymentStatus, type PendingBalance } from '../payments';
import { usePendingBalances } from '../payments/hooks';
import PaymentStatusBadge from '../payments/PaymentStatusBadge';
import { formatDateTime } from '../sessions/format';
import {
  BALANCE_LIMIT,
  balanceTotals,
  FOLLOW_UP_LIMIT,
  followUps,
  recentSessions,
  type FollowUp,
} from './home';
import { useHomeData, useToday } from './hooks';
import ReviewCard from '../conflicts/ReviewCard';

const rowClass =
  'flex min-h-11 flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-base text-stone-600">{children}</p>;
}

function FollowUpWhen({ days, date }: { days: number; date: string }) {
  const { t } = useTranslation();
  if (days < 0) {
    return (
      <span className="text-sm font-medium text-red-800">
        {t('home.followUps.overdue', { count: -days })}
      </span>
    );
  }
  if (days === 0) {
    return <span className="text-sm font-medium text-amber-800">{t('home.followUps.today')}</span>;
  }
  if (days === 1) return <span className="text-sm">{t('home.followUps.tomorrow')}</span>;
  return <span className="text-sm text-stone-600">{formatDate(date)}</span>;
}

function FollowUpList({ items }: { items: FollowUp[] }) {
  const { t } = useTranslation();
  const shown = items.slice(0, FOLLOW_UP_LIMIT);
  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map(({ session, client, days }) => (
          <li key={session.id}>
            <Link to={`/sessions/${session.id}`} className={rowClass}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{client.name}</span>
                <FollowUpWhen days={days} date={session.follow_up_date ?? ''} />
              </span>
              {session.follow_up_note.trim() !== '' && (
                <span className="line-clamp-1 text-sm text-stone-600">
                  {session.follow_up_note}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <p className="text-sm text-stone-600">
          {t('home.followUps.more', { count: items.length - shown.length })}
        </p>
      )}
    </>
  );
}

function BalanceList({
  balances,
  clientName,
}: {
  balances: PendingBalance[];
  clientName: (clientId: string) => string;
}) {
  const { t } = useTranslation();
  const totals = balanceTotals(balances);
  const shown = balances.slice(0, BALANCE_LIMIT);
  return (
    <>
      <p className="text-base">
        <span className="font-medium">{t('home.balances.total')}:</span>{' '}
        {CURRENCIES.flatMap((currency) => {
          const total = totals[currency];
          return total === undefined ? [] : [formatMoney(total, currency)];
        }).join(' · ')}
      </p>
      <ul className="flex flex-col gap-2">
        {shown.map(({ session, balance_minor, currency }) => (
          <li key={session.id}>
            <Link to={`/sessions/${session.id}`} className={rowClass}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{clientName(session.client_id)}</span>
                <span>{formatMoney(balance_minor, currency)}</span>
              </span>
              <span className="text-sm text-stone-600">{formatDateTime(session.started_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/payments" className="flex min-h-11 items-center self-start text-base underline">
        {t('home.balances.all')}
      </Link>
    </>
  );
}

/** The three sections; nothing until the data has loaded. */
function HomeSections() {
  const { t } = useTranslation();
  const today = useToday();
  const data = useHomeData();
  const pending = usePendingBalances();

  if (data === undefined || pending === undefined) return null;

  const { sessions, clients, payments } = data;
  const due = followUps(sessions, clients, today);
  // Deleting a client tombstones its sessions too; this only guards against stray rows.
  const balances = pending.filter(({ session }) => clients.has(session.client_id));
  const recent = recentSessions(sessions, clients);

  return (
    <>
      <Section id="home-follow-ups" title={t('home.followUps.title')}>
        {due.length === 0 ? (
          <Empty>{t('home.followUps.empty')}</Empty>
        ) : (
          <FollowUpList items={due} />
        )}
      </Section>

      <Section id="home-balances" title={t('home.balances.title')}>
        {balances.length === 0 ? (
          <Empty>{t('home.balances.empty')}</Empty>
        ) : (
          <BalanceList balances={balances} clientName={(id) => clients.get(id)?.name ?? ''} />
        )}
      </Section>

      <Section id="home-recent" title={t('home.recent.title')}>
        {recent.length === 0 ? (
          <div className="flex flex-col gap-1">
            <Empty>{t('home.recent.empty')}</Empty>
            <Link
              to="/clients"
              className="flex min-h-11 items-center self-start text-base underline"
            >
              {t('home.recent.start')}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map(({ session, client }) => (
              <li key={session.id}>
                <Link to={`/sessions/${session.id}`} className={rowClass}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{client.name}</span>
                    <span className="text-sm text-stone-600">
                      {formatDateTime(session.started_at)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm text-stone-600">
                      {t(`sessions.type.${session.type}`)}
                    </span>
                    <PaymentStatusBadge
                      status={
                        paymentStatus(
                          session,
                          payments.filter((p) => p.session_id === session.id),
                        ).status
                      }
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/** Inicio: follow-ups due, money still owed and the latest sessions. */
export default function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <ReviewCard />
      <HomeSections />
      <Link
        to="/settings"
        className="flex min-h-11 items-center self-center text-base text-stone-600 underline"
      >
        {t('settings.link')}
      </Link>
    </div>
  );
}
