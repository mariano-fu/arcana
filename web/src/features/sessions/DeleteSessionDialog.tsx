import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { CURRENCIES, formatMoney } from '../payments';
import { formatList } from '../clients/format';
import type { SessionDeletionSummary } from './actions';
import { useSessionDeletionSummary } from './hooks';

interface Props {
  sessionId: string;
  onDelete: () => void;
  onCancel: () => void;
}

/** Confirms deleting a session, saying exactly what goes with it (same pattern as clients). */
export default function DeleteSessionDialog({ sessionId, onDelete, onCancel }: Props) {
  const { t } = useTranslation();
  const summary = useSessionDeletionSummary(sessionId);
  const titleId = `delete-session-${sessionId}`;

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-stone-900/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-white p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('sessions.delete.title')}
        </h2>
        {summary && <p className="text-base">{summaryText(summary, t)}</p>}
        <p className="text-sm text-stone-600">{t('sessions.delete.irreversible')}</p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="min-h-11 rounded-lg border border-red-300 text-base text-red-700"
          >
            {t('sessions.delete.confirm')}
          </button>
          <button type="button" onClick={onCancel} className="min-h-11 text-base text-stone-600">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Se eliminarán la sesión, 1 tirada y 2 pagos (₡10 000 y US$20,00)." */
function summaryText(summary: SessionDeletionSummary, t: TFunction): string {
  if (summary.readings === 0 && summary.payments === 0) return t('sessions.delete.onlySession');

  const items = [t('sessions.delete.session')];
  if (summary.readings > 0) items.push(t('sessions.delete.readings', { count: summary.readings }));
  if (summary.payments > 0) {
    const totals = CURRENCIES.flatMap((currency) => {
      const amount = summary.paidByCurrency[currency];
      return amount === undefined ? [] : [formatMoney(amount, currency)];
    });
    items.push(
      t('sessions.delete.payments', { count: summary.payments, totals: formatList(totals) }),
    );
  }
  return t('sessions.delete.summary', { items: formatList(items) });
}
