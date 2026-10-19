import { useTranslation } from 'react-i18next';

import { paymentStatusKey, type PaymentStatusKind } from './status';

const COLORS: Record<PaymentStatusKind, string> = {
  paid: 'bg-emerald-100 text-emerald-900',
  partial: 'bg-amber-100 text-amber-900',
  pending: 'bg-red-100 text-red-900',
  no_charge: 'bg-stone-200 text-stone-800',
  overpaid: 'bg-sky-100 text-sky-900',
};

/** Pagado / Parcial / Pendiente / Sin cobro / Saldo a favor, as a pill. */
export default function PaymentStatusBadge({ status }: { status: PaymentStatusKind }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-medium ${COLORS[status]}`}
    >
      {t(paymentStatusKey(status))}
    </span>
  );
}
