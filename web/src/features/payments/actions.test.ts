import { db, repos } from '../../db';
import { clearDb, newClient, newSession } from '../clients/test-utils';
import { createPayment, deletePayment, updatePayment, type PaymentFields } from '.';

const fields: PaymentFields = {
  amount_minor: 1_000_000,
  currency: 'CRC',
  method: 'sinpe',
  paid_at: '2026-10-19',
  reference: '12345678',
  note: '',
};

beforeEach(clearDb);

async function setup() {
  const client = await repos.client.create(newClient());
  const session = await repos.session.create(newSession(client.id));
  return { client, session };
}

describe('payment actions', () => {
  it('records a payment on the session, denormalizing the client', async () => {
    const { client, session } = await setup();

    const payment = await createPayment(repos, session, fields);

    expect(await repos.payment.get(payment.id)).toMatchObject({
      ...fields,
      session_id: session.id,
      client_id: client.id,
      pending: 1,
    });
  });

  it('updates the editable fields only', async () => {
    const { session } = await setup();
    const payment = await createPayment(repos, session, fields);

    await updatePayment(repos, payment.id, {
      ...fields,
      amount_minor: 4_050,
      currency: 'USD',
      method: 'paypal',
      reference: null,
    });

    expect(await repos.payment.get(payment.id)).toMatchObject({
      session_id: session.id,
      amount_minor: 4_050,
      currency: 'USD',
      method: 'paypal',
      reference: null,
    });
  });

  it('tombstones a deleted payment so it syncs', async () => {
    const { session } = await setup();
    const payment = await createPayment(repos, session, fields);

    await deletePayment(repos, payment.id);

    expect(await repos.payment.get(payment.id)).toBeUndefined();
    expect(await db.payment.get(payment.id)).toMatchObject({ pending: 1 });
    expect((await db.payment.get(payment.id))?.deleted_at).not.toBeNull();
  });
});
