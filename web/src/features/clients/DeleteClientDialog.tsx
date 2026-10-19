import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Client, Currency } from '../../db';
import type { DeletionSummary } from './deletion';
import { formatList, formatMoney } from './format';
import { useDeletionSummary } from './hooks';

const CURRENCIES: Currency[] = ['CRC', 'USD'];

interface Props {
  client: Client;
  onArchive: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

/**
 * Confirms a permanent delete. Says exactly what goes with the client and nudges toward
 * archiving: archive is the prominent action, delete the secondary one.
 */
export default function DeleteClientDialog({ client, onArchive, onDelete, onCancel }: Props) {
  const { t } = useTranslation();
  const summary = useDeletionSummary(client.id);
  const titleId = `delete-client-${client.id}`;

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-stone-900/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('clients.delete.title', { name: client.name })}
        </h2>
        {summary && <p className="text-base">{summaryText(summary, t)}</p>}
        <p className="text-sm text-stone-600">{t('clients.delete.irreversible')}</p>
        {!client.archived && (
          <p className="text-sm text-stone-700">{t('clients.delete.suggestArchive')}</p>
        )}
        <div className="mt-2 flex flex-col gap-2">
          {!client.archived && (
            <button
              type="button"
              onClick={onArchive}
              className="min-h-11 rounded-lg bg-stone-900 text-base font-medium text-stone-50"
            >
              {t('clients.delete.archiveInstead')}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="min-h-11 rounded-lg border border-red-300 text-base text-red-700"
          >
            {t('clients.delete.confirm')}
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 text-base text-stone-600">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Se eliminarán 4 sesiones y 3 pagos (₡45 000)." */
function summaryText(summary: DeletionSummary, t: TFunction): string {
  if (summary.sessions === 0 && summary.payments === 0) return t('clients.delete.onlyProfile');

  const items: string[] = [];
  if (summary.sessions > 0) items.push(t('clients.delete.sessions', { count: summary.sessions }));
  if (summary.payments > 0) {
    const totals = CURRENCIES.flatMap((currency) => {
      const amount = summary.paidByCurrency[currency];
      return amount === undefined ? [] : [formatMoney(amount, currency)];
    });
    items.push(
      t('clients.delete.payments', { count: summary.payments, totals: formatList(totals) }),
    );
  }
  // The verb agrees with the total: "Se eliminará 1 sesión" / "Se eliminarán 1 sesión y 1 pago".
  return t('clients.delete.summary', {
    count: summary.sessions + summary.payments,
    items: formatList(items),
  });
}
