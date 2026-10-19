import { useTranslation } from 'react-i18next';

import { formatList } from '../clients/format';
import { useClientSessions } from '../sessions/hooks';
import { useClientPayments } from './hooks';
import { CURRENCIES, formatMoney, type CurrencyTotals } from './money';
import { clientPaymentTotals } from './totals';

/** Total paid, what's still owed and any saldo a favor, each per currency (never netted). */
export default function ClientPaymentSummary({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const sessions = useClientSessions(clientId);
  const payments = useClientPayments(clientId);

  if (sessions === undefined || payments === undefined) return null;
  const totals = clientPaymentTotals(sessions, payments);
  const rows = [
    { label: t('payments.client.paid'), amounts: formatTotals(totals.paid) },
    { label: t('payments.client.pending'), amounts: formatTotals(totals.pending) },
    { label: t('payments.client.credit'), amounts: formatTotals(totals.credit) },
  ].filter((row) => row.amounts.length > 0);

  if (rows.length === 0) return <p className="text-stone-600">{t('payments.client.none')}</p>;
  return (
    <dl className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <dt className="text-stone-700">{row.label}</dt>
          <dd className="font-medium">{formatList(row.amounts)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatTotals(totals: CurrencyTotals): string[] {
  return CURRENCIES.flatMap((currency) => {
    const amount = totals[currency];
    return amount === undefined || amount === 0 ? [] : [formatMoney(amount, currency)];
  });
}
