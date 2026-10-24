import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Currency } from '../../db';
import { isEdited, useUnsavedForm } from '../forms/unsaved';
import {
  PAYMENT_METHODS,
  validatePaymentForm,
  type PaymentFields,
  type PaymentFormErrors,
  type PaymentFormValues,
} from './form';
import { CURRENCIES, CURRENCY_SYMBOL, formatMoney, parseMoney } from './money';

interface Props {
  initial: PaymentFormValues;
  onSave: (fields: PaymentFields) => Promise<unknown>;
  onCancel: () => void;
  /** Set when editing a saved payment: its formatted amount, and how to delete it. */
  existing?: { amount: string; onDelete: () => Promise<unknown> };
}

/**
 * Add or edit one payment. Unlike the session fields, a payment is saved with an explicit
 * button, so a half-typed amount never becomes a record.
 */
export default function PaymentForm({ initial, onSave, onCancel, existing }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  // The parent rebuilds `initial` on every render; compare with the values the form opened with.
  const [start] = useState(initial);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const clearUnsaved = useUnsavedForm(isEdited(values, start));

  function set<K extends keyof PaymentFormValues>(key: K, value: PaymentFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setSaveFailed(false);
    try {
      await action();
      clearUnsaved();
    } catch {
      setSaveFailed(true);
      setBusy(false);
    }
  }

  function submit() {
    const result = validatePaymentForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    void run(() => onSave(result.fields));
  }

  const parsedAmount = parseMoney(values.amount);

  return (
    <form
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-stone-300 bg-stone-50 p-4"
    >
      <h3 id={titleId} className="text-base font-semibold">
        {existing ? t('payments.form.editTitle') : t('payments.form.addTitle')}
      </h3>

      <div className="flex gap-2">
        <div className="flex-1">
          <Field
            label={t('payments.field.amount')}
            hint={
              parsedAmount !== null && parsedAmount > 0
                ? t('payments.field.amountPreview', {
                    amount: formatMoney(parsedAmount, values.currency),
                  })
                : t('payments.field.amountHint')
            }
            error={errors.amount ? t('payments.error.amount') : undefined}
          >
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(event) => {
                  set('amount', event.target.value);
                }}
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <Field label={t('payments.field.currency')}>
          {(id) => (
            <select
              id={id}
              value={values.currency}
              onChange={(event) => {
                set('currency', event.target.value as Currency);
              }}
              className={inputClass}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {CURRENCY_SYMBOL[currency]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium text-stone-700">
          {t('payments.method.label')}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              aria-pressed={values.method === method}
              onClick={() => {
                set('method', method);
              }}
              className={`min-h-11 rounded-lg border px-2 text-base ${
                values.method === method
                  ? 'border-stone-900 bg-stone-900 text-stone-50'
                  : 'border-stone-300 bg-white'
              }`}
            >
              {t(`payments.method.${method}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <Field
        label={t('payments.field.paidAt')}
        error={errors.paid_at ? t('payments.error.paidAt') : undefined}
      >
        {(id) => (
          <input
            id={id}
            type="date"
            value={values.paid_at}
            onChange={(event) => {
              set('paid_at', event.target.value);
            }}
            className={inputClass}
          />
        )}
      </Field>

      <Field label={t('payments.field.reference')} hint={t('payments.field.referenceHint')}>
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={values.reference}
            onChange={(event) => {
              set('reference', event.target.value);
            }}
            className={inputClass}
          />
        )}
      </Field>

      <Field label={t('payments.field.note')}>
        {(id) => (
          <textarea
            id={id}
            value={values.note}
            onChange={(event) => {
              set('note', event.target.value);
            }}
            rows={2}
            className={`${inputClass} py-2`}
          />
        )}
      </Field>

      {saveFailed && (
        <p role="alert" className="text-sm text-red-700">
          {t('payments.error.save')}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-stone-900 px-4 text-base font-medium text-stone-50"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={() => {
            clearUnsaved();
            onCancel();
          }}
          className="min-h-11 text-base text-stone-600"
        >
          {t('common.cancel')}
        </button>
      </div>

      {existing &&
        (confirmingDelete ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 p-3">
            <p className="text-base">{t('payments.delete.confirm', { amount: existing.amount })}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(existing.onDelete)}
              className="min-h-11 rounded-lg border border-red-300 bg-white text-base text-red-700"
            >
              {t('payments.delete.yes')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
              }}
              className="min-h-11 text-base text-stone-600"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(true);
            }}
            className="min-h-11 self-start rounded-lg border border-stone-300 bg-white px-4 text-base text-red-700"
          >
            {t('payments.delete.button')}
          </button>
        ))}
    </form>
  );
}

// 16px text keeps iOS Safari from zooming in on focus.
const inputClass = 'min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-stone-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
