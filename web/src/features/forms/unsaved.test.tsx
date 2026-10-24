import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import es from '../../i18n/locales/es.json';
import PaymentForm from '../payments/PaymentForm';
import type { PaymentFormValues } from '../payments/form';
import { hasUnsavedForms, isEdited, useUnsavedForm } from './unsaved';

function Harness({ dirty }: { dirty: boolean }) {
  const clear = useUnsavedForm(dirty);
  return (
    <button type="button" onClick={clear}>
      clear
    </button>
  );
}

const blankPayment: PaymentFormValues = {
  amount: '',
  currency: 'CRC',
  method: 'sinpe',
  paid_at: '2026-10-21',
  reference: '',
  note: '',
};

function renderPaymentForm(onSave = () => Promise.resolve()) {
  // Like the session page: the form closes once it's saved or cancelled.
  function Host() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <PaymentForm
        initial={{ ...blankPayment }}
        onSave={() =>
          onSave().then(() => {
            setOpen(false);
          })
        }
        onCancel={() => {
          setOpen(false);
        }}
      />
    );
  }
  render(<Host />);
}

describe('useUnsavedForm', () => {
  it('counts a form only while it is dirty', () => {
    const { rerender } = render(<Harness dirty={false} />);
    expect(hasUnsavedForms()).toBe(false);

    rerender(<Harness dirty />);
    expect(hasUnsavedForms()).toBe(true);

    rerender(<Harness dirty={false} />);
    expect(hasUnsavedForms()).toBe(false);
  });

  it('clears on unmount', () => {
    const { unmount } = render(<Harness dirty />);
    expect(hasUnsavedForms()).toBe(true);

    unmount();
    expect(hasUnsavedForms()).toBe(false);
  });

  it('clears when asked, and counts again once the form is edited again', async () => {
    const { rerender } = render(<Harness dirty />);

    await userEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(hasUnsavedForms()).toBe(false);

    rerender(<Harness dirty={false} />);
    rerender(<Harness dirty />);
    expect(hasUnsavedForms()).toBe(true);
  });

  it('isEdited compares each field with the starting values', () => {
    expect(isEdited({ a: '1', b: false }, { a: '1', b: false })).toBe(false);
    expect(isEdited({ a: '1', b: true }, { a: '1', b: false })).toBe(true);
  });
});

describe('payment form', () => {
  it('counts once edited, and not after it is saved', async () => {
    renderPaymentForm();
    expect(hasUnsavedForms()).toBe(false);

    await userEvent.type(screen.getByLabelText(es.payments.field.amount), '15000');
    expect(hasUnsavedForms()).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: es.common.save }));
    expect(hasUnsavedForms()).toBe(false);
  });

  it('still counts when the save fails', async () => {
    renderPaymentForm(() => Promise.reject(new Error('disk full')));
    await userEvent.type(screen.getByLabelText(es.payments.field.amount), '15000');

    await userEvent.click(screen.getByRole('button', { name: es.common.save }));

    expect(await screen.findByText(es.payments.error.save)).toBeVisible();
    expect(hasUnsavedForms()).toBe(true);
  });

  it('does not count after "Cancelar"', async () => {
    renderPaymentForm();
    await userEvent.type(screen.getByLabelText(es.payments.field.note), 'Pagó la mitad');

    await userEvent.click(screen.getByRole('button', { name: es.common.cancel }));

    expect(hasUnsavedForms()).toBe(false);
  });
});
