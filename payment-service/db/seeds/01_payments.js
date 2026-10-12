// Dummy data for local development: one payment per status, with its transactions.
const USER_ID = '00000000-0000-4000-8000-000000000001';

const payments = [
  { id: '11111111-1111-4111-8111-111111111111', status: 'PENDING', amount: 45000 },
  { id: '22222222-2222-4222-8222-222222222222', status: 'AUTHORIZED', amount: 120000 },
  { id: '33333333-3333-4333-8333-333333333333', status: 'CAPTURED', amount: 89900 },
  { id: '44444444-4444-4444-8444-444444444444', status: 'FAILED', amount: 25000 },
  { id: '55555555-5555-4555-8555-555555555555', status: 'REFUNDED', amount: 60000 },
];

const transactionsByStatus = {
  PENDING: [],
  AUTHORIZED: [{ type: 'CHARGE', status: 'SUCCEEDED' }],
  CAPTURED: [
    { type: 'CHARGE', status: 'SUCCEEDED' },
    { type: 'CAPTURE', status: 'SUCCEEDED' },
  ],
  FAILED: [{ type: 'CHARGE', status: 'FAILED' }],
  REFUNDED: [
    { type: 'CHARGE', status: 'SUCCEEDED' },
    { type: 'CAPTURE', status: 'SUCCEEDED' },
    { type: 'REFUND', status: 'SUCCEEDED' },
  ],
};

exports.seed = async function seed(knex) {
  await knex('idempotency_keys').del();
  await knex('transactions').del();
  await knex('payments').del();

  await knex('payments').insert(
    payments.map((payment, index) => ({
      ...payment,
      session_id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${index + 1}`,
      user_id: USER_ID,
      currency: 'MXN',
    })),
  );

  await knex('transactions').insert(
    payments.flatMap((payment) =>
      transactionsByStatus[payment.status].map((transaction, index) => ({
        ...transaction,
        payment_id: payment.id,
        amount: payment.amount,
        provider_reference: `sandbox_${payment.status.toLowerCase()}_${index + 1}`,
      })),
    ),
  );

  await knex('idempotency_keys').insert({
    key: 'seed-idempotency-key-captured',
    request_hash: 'seed-request-hash',
    payment_id: payments[2].id,
    response_status: 201,
    response_body: JSON.stringify({ id: payments[2].id, status: 'CAPTURED' }),
  });
};
