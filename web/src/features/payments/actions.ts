import type { Payment, Repositories, Session } from '../../db';
import type { PaymentFields } from './form';

type PaymentRepos = Pick<Repositories, 'payment'>;

/** Records a payment against the session; `client_id` is denormalized from it. */
export function createPayment(
  repos: PaymentRepos,
  session: Pick<Session, 'id' | 'client_id'>,
  fields: PaymentFields,
): Promise<Payment> {
  return repos.payment.create({ ...fields, session_id: session.id, client_id: session.client_id });
}

/** Only the editable fields change; the payment stays on its session and client. */
export function updatePayment(
  repos: PaymentRepos,
  id: string,
  fields: PaymentFields,
): Promise<Payment> {
  return repos.payment.update(id, fields);
}

/** Soft delete, so the tombstone syncs. */
export function deletePayment(repos: PaymentRepos, id: string): Promise<void> {
  return repos.payment.remove(id);
}
