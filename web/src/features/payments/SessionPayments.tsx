import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repos, type Payment, type Session } from '../../db';
import { formatDate, formatList } from '../clients/format';
import { createPayment, deletePayment, updatePayment } from './actions';
import { defaultPaymentValues, paymentToValues, todayLocal } from './form';
import { useSessionPayments } from './hooks';
import { CURRENCIES, formatMoney } from './money';
import PaymentForm from './PaymentForm';
import PaymentStatusBadge from './PaymentStatusBadge';
import { paymentStatus, type PaymentStatus } from './status';

/** The "Pagos" section of the session page: status, the payments, and adding or editing one. */
export default function SessionPayments({ session }: { session: Session }) {
  const { t } = useTranslation();
  const payments = useSessionPayments(session.id);
  /** `'new'` while adding, a payment id while editing it. */
  const [editing, setEditing] = useState<string | null>(null);

  if (payments === undefined) return null;
  const status = paymentStatus(session, payments);
  const close = () => {
    setEditing(null);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('payments.section.title')}</h2>
        <PaymentStatusBadge status={status.status} />
      </div>
      <StatusSummary status={status} />

      {payments.length === 0 ? (
        <p className="text-base text-stone-600">{t('payments.section.empty')}</p>
      ) : (
        <ul aria-label={t('payments.section.list')} className="flex flex-col gap-2">
          {payments.map((payment) => (
            <li key={payment.id}>
              {editing === payment.id ? (
                <PaymentForm
                  initial={paymentToValues(payment)}
                  onSave={(fields) => updatePayment(repos, payment.id, fields).then(close)}
                  onCancel={close}
                  existing={{
                    amount: formatMoney(payment.amount_minor, payment.currency),
                    onDelete: () => deletePayment(repos, payment.id).then(close),
                  }}
                />
              ) : (
                <PaymentItem
                  payment={payment}
                  onOpen={() => {
                    setEditing(payment.id);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing === 'new' ? (
        <PaymentForm
          initial={defaultPaymentValues(status, todayLocal())}
          onSave={(fields) => createPayment(repos, session, fields).then(close)}
          onCancel={close}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing('new');
          }}
          className="flex min-h-11 items-center justify-center self-start rounded-lg border border-stone-300 bg-white px-4 text-base"
        >
          {t('payments.section.add')}
        </button>
      )}
    </section>
  );
}

/** "Pagado ₡10 000 de ₡15 000. Falta ₡5 000." plus payments in the other currency, if any. */
function StatusSummary({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  if (status.status !== 'no_charge') {
    lines.push(
      t('payments.summary.paidOfPrice', {
        paid: formatMoney(status.paid_minor, status.currency),
        price: formatMoney(status.price_minor, status.currency),
      }),
    );
    if (status.balance_minor > 0) {
      lines.push(
        t('payments.summary.remaining', {
          amount: formatMoney(status.balance_minor, status.currency),
        }),
      );
    } else if (status.balance_minor < 0) {
      lines.push(
        t('payments.summary.credit', {
          amount: formatMoney(-status.balance_minor, status.currency),
        }),
      );
    }
  }
  const other = CURRENCIES.flatMap((currency) => {
    const amount = status.other_currency_paid[currency];
    return amount === undefined ? [] : [formatMoney(amount, currency)];
  });

  if (lines.length === 0 && other.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-base">
      {lines.length > 0 && <p>{lines.join(' ')}</p>}
      {other.length > 0 && (
        <p className="text-sm text-stone-600">
          {t('payments.summary.otherCurrency', { amounts: formatList(other) })}
        </p>
      )}
    </div>
  );
}

function PaymentItem({ payment, onOpen }: { payment: Payment; onOpen: () => void }) {
  const { t } = useTranslation();
  const details = [t(`payments.method.${payment.method}`), formatDate(payment.paid_at)];
  if (payment.reference !== null) {
    details.push(t('payments.item.reference', { reference: payment.reference }));
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full flex-col gap-1 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left"
    >
      <span className="font-medium">{formatMoney(payment.amount_minor, payment.currency)}</span>
      <span className="text-sm text-stone-600">{details.join(' · ')}</span>
      {payment.note !== '' && (
        <span className="text-sm whitespace-pre-wrap text-stone-600">{payment.note}</span>
      )}
    </button>
  );
}
