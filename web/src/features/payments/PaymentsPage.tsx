import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import type { Client, Payment, PaymentMethod } from '../../db';
import { formatDate, formatDay } from '../clients/format';
import { buildPaymentsCsv } from './csv';
import { downloadTextFile } from './download';
import { PAYMENT_METHODS } from './form';
import { useClientsById, useMonthPayments, usePendingBalances } from './hooks';
import { CURRENCIES, formatMoney } from './money';
import {
  currentMonth,
  filterPayments,
  formatMonth,
  isMonth,
  monthIncome,
  shiftMonth,
  type Month,
  type PendingBalance,
} from './report';

const sectionClass = 'flex flex-col gap-3';
const headingClass = 'text-lg font-semibold';
const buttonClass =
  'flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-base';
const selectClass = 'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base';
const itemClass =
  'flex min-h-11 w-full flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3';

function isMethod(value: string | null): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value ?? '');
}

/**
 * The "Pagos" screen (US-2b.5, US-2b.6). Month, method and client live in the URL
 * (`?month=2026-10&method=sinpe&client=…`), so coming back from a session keeps them.
 */
export default function PaymentsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month') ?? '';
  const month = isMonth(monthParam) ? monthParam : currentMonth();
  const methodParam = params.get('method');
  const method = isMethod(methodParam) ? methodParam : null;
  const clientId = params.get('client') || null;

  const payments = useMonthPayments(month);
  const pending = usePendingBalances();
  const clients = useClientsById();

  function updateParams(updates: Partial<Record<'month' | 'method' | 'client', string | null>>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  if (pending === undefined || clients === undefined) return null;
  const monthLabel = formatMonth(month);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('payments.page.title')}</h1>

      <MonthPicker
        month={month}
        onChange={(next) => {
          updateParams({ month: next });
        }}
      />

      <section className={sectionClass}>
        <h2 className={headingClass}>{t('payments.page.income.title')}</h2>
        {/* Month picker stays mounted while a new month loads; only its data waits. */}
        {payments && <MonthIncome payments={payments} monthLabel={monthLabel} />}
      </section>

      <section className={sectionClass}>
        <h2 className={headingClass}>{t('payments.page.pending.title')}</h2>
        <PendingList pending={pending} clients={clients} />
      </section>

      <section className={sectionClass}>
        <h2 className={headingClass}>{t('payments.page.list.title', { month: monthLabel })}</h2>
        {payments && (
          <MonthPayments
            payments={payments}
            clients={clients}
            month={month}
            method={method}
            clientId={clientId}
            onFilter={updateParams}
          />
        )}
      </section>
    </div>
  );
}

function MonthPicker({ month, onChange }: { month: Month; onChange: (month: Month) => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('payments.page.month.label')}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        aria-label={t('payments.page.month.previous')}
        onClick={() => {
          onChange(shiftMonth(month, -1));
        }}
        className={`${buttonClass} min-w-11 px-0`}
      >
        ‹
      </button>
      <p
        aria-live="polite"
        className="flex-1 text-center text-lg font-medium first-letter:uppercase"
      >
        {formatMonth(month)}
      </p>
      <button
        type="button"
        aria-label={t('payments.page.month.next')}
        onClick={() => {
          onChange(shiftMonth(month, 1));
        }}
        className={`${buttonClass} min-w-11 px-0`}
      >
        ›
      </button>
    </div>
  );
}

function MonthIncome({ payments, monthLabel }: { payments: Payment[]; monthLabel: string }) {
  const { t } = useTranslation();
  const income = monthIncome(payments);
  const amounts = CURRENCIES.flatMap((currency) => {
    const amount = income[currency];
    return amount === undefined ? [] : [formatMoney(amount, currency)];
  });
  if (amounts.length === 0) {
    return (
      <p className="text-base text-stone-600">
        {t('payments.page.income.none', { month: monthLabel })}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {amounts.map((amount) => (
        <li key={amount} className="text-2xl font-semibold">
          {amount}
        </li>
      ))}
    </ul>
  );
}

function PendingList({
  pending,
  clients,
}: {
  pending: PendingBalance[];
  clients: Map<string, Client>;
}) {
  const { t } = useTranslation();
  if (pending.length === 0) {
    return <p className="text-base text-stone-600">{t('payments.page.pending.none')}</p>;
  }
  return (
    <ul aria-label={t('payments.page.pending.list')} className="flex flex-col gap-2">
      {pending.map(({ session, balance_minor, currency }) => (
        <li key={session.id}>
          <Link to={`/sessions/${session.id}`} className={itemClass}>
            <span className="flex justify-between gap-3">
              <span className="font-medium">
                {clients.get(session.client_id)?.name ?? t('payments.page.csv.unknownClient')}
              </span>
              <span className="font-medium text-red-900">
                {t('payments.page.pending.owes', { amount: formatMoney(balance_minor, currency) })}
              </span>
            </span>
            <span className="text-sm text-stone-600">{formatDay(session.started_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MonthPayments({
  payments,
  clients,
  month,
  method,
  clientId,
  onFilter,
}: {
  payments: Payment[];
  clients: Map<string, Client>;
  month: Month;
  method: PaymentMethod | null;
  clientId: string | null;
  onFilter: (updates: { method?: string | null; client?: string | null }) => void;
}) {
  const { t } = useTranslation();
  const monthLabel = formatMonth(month);
  const clientName = (id: string) => clients.get(id)?.name ?? t('payments.page.csv.unknownClient');

  // Clients with a payment this month, plus the selected one so the picker never loses it.
  const clientIds = new Set(payments.map((p) => p.client_id));
  if (clientId !== null) clientIds.add(clientId);
  const clientOptions = [...clientIds]
    .map((id) => ({ id, name: clientName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const shown = filterPayments(payments, { method, clientId });

  function exportCsv() {
    const csv = buildPaymentsCsv(
      payments,
      new Map([...clients].map(([id, client]) => [id, client.name])),
      {
        headers: [
          t('payments.page.csv.date'),
          t('payments.page.csv.client'),
          t('payments.page.csv.amount'),
          t('payments.page.csv.currency'),
          t('payments.page.csv.method'),
          t('payments.page.csv.reference'),
          t('payments.page.csv.note'),
        ],
        method: Object.fromEntries(
          PAYMENT_METHODS.map((m) => [m, t(`payments.method.${m}`)]),
        ) as Record<PaymentMethod, string>,
        unknownClient: t('payments.page.csv.unknownClient'),
      },
    );
    downloadTextFile(t('payments.page.export.filename', { month }), csv, 'text/csv;charset=utf-8');
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-stone-700">{t('payments.page.filter.method')}</span>
          <select
            value={method ?? ''}
            onChange={(event) => {
              onFilter({ method: event.target.value || null });
            }}
            className={selectClass}
          >
            <option value="">{t('payments.page.filter.all')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`payments.method.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-stone-700">{t('payments.page.filter.client')}</span>
          <select
            value={clientId ?? ''}
            onChange={(event) => {
              onFilter({ client: event.target.value || null });
            }}
            className={selectClass}
          >
            <option value="">{t('payments.page.filter.all')}</option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {payments.length === 0 ? (
        <p className="text-base text-stone-600">
          {t('payments.page.list.none', { month: monthLabel })}
        </p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-stone-600">{t('payments.page.list.noMatch')}</p>
          <button
            type="button"
            onClick={() => {
              onFilter({ method: null, client: null });
            }}
            className={buttonClass}
          >
            {t('payments.page.list.clearFilters')}
          </button>
        </div>
      ) : (
        <ul aria-label={t('payments.page.list.label')} className="flex flex-col gap-2">
          {shown.map((payment) => (
            <li key={payment.id}>
              <PaymentRow payment={payment} clientName={clientName(payment.client_id)} />
            </li>
          ))}
        </ul>
      )}

      {payments.length > 0 && (
        <div className="flex flex-col items-start gap-1">
          <button type="button" onClick={exportCsv} className={buttonClass}>
            {t('payments.page.export.button')}
          </button>
          <p className="text-sm text-stone-600">
            {t('payments.page.export.hint', { month: monthLabel })}
          </p>
        </div>
      )}
    </>
  );
}

function PaymentRow({ payment, clientName }: { payment: Payment; clientName: string }) {
  const { t } = useTranslation();
  const details = [t(`payments.method.${payment.method}`), formatDate(payment.paid_at)];
  if (payment.reference !== null) {
    details.push(t('payments.item.reference', { reference: payment.reference }));
  }
  return (
    <Link to={`/sessions/${payment.session_id}`} className={itemClass}>
      <span className="flex justify-between gap-3">
        <span className="font-medium">{clientName}</span>
        <span className="font-medium">{formatMoney(payment.amount_minor, payment.currency)}</span>
      </span>
      <span className="text-sm text-stone-600">{details.join(' · ')}</span>
    </Link>
  );
}
