import { expect, test } from '@playwright/test';

import { callAs, createPublishedGaEvent } from './support/orders';
import { assertLocalStack, sql, withServiceDown } from './support/stack';

const runId = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

async function createOrder(
  request: Parameters<typeof callAs>[0],
  eventId: number,
  quantity: number,
) {
  const created = await callAs(request, 'customer', 'post', '/api/order/orders', {
    eventId,
    quantity,
    customerEmail: 'payer@example.com',
    customerName: 'E2E Payer',
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { order: { order_id: number } }).order.order_id;
}

const pay = (request: Parameters<typeof callAs>[0], orderId: number) =>
  callAs(request, 'customer', 'post', `/api/order/orders/${orderId}/payment-requests`, {
    paymentToken: 'simulated',
  });

const tickets = (orderId: number) =>
  Number(sql(`SELECT COUNT(*) FROM ticketing.tickets WHERE order_id = ${orderId}`));
const status = (orderId: number) =>
  sql(`SELECT status FROM checkout.orders WHERE order_id = ${orderId}`);

const payments = (orderId: number) =>
  Number(sql(`SELECT COUNT(*) FROM checkout.payments WHERE order_id = ${orderId}`));

interface PaidOrder {
  readonly order: { readonly status: string; readonly payments: { readonly payment_id: number }[] };
}

test('paying the same order twice at once charges and issues only once', async ({ request }) => {
  const eventId = await createPublishedGaEvent(request, `E2E Double Payment ${runId}`, 5);
  const orderId = await createOrder(request, eventId, 2);

  // Two submissions at the same moment, as a double click or a retried request would make.
  const responses = await Promise.all([pay(request, orderId), pay(request, orderId)]);
  const bodies: PaidOrder[] = [];
  for (const response of responses) {
    expect(response.status()).toBe(200);
    bodies.push((await response.json()) as PaidOrder);
  }
  for (const body of bodies) expect(body.order.status).toBe('PAID');
  expect(bodies[0].order.payments[0].payment_id).toBe(bodies[1].order.payments[0].payment_id);

  await expect.poll(() => tickets(orderId), { timeout: 30_000 }).toBe(2);
  expect(payments(orderId)).toBe(1);

  // Paying an order that is already paid is harmless and issues nothing more.
  const again = await pay(request, orderId);
  expect(again.status()).toBe(200);
  expect(tickets(orderId)).toBe(2);
  expect(payments(orderId)).toBe(1);
});

test('a payment made while the ticket service is down is recovered by paying again', async ({
  request,
}) => {
  const eventId = await createPublishedGaEvent(request, `E2E Ticket Outage ${runId}`, 5);
  const orderId = await createOrder(request, eventId, 2);

  await withServiceDown('ticket-service', async () => {
    const during = await pay(request, orderId);
    expect(during.status()).toBe(502);
    expect(((await during.json()) as { error: string }).error).toBe('payment_processing_failed');
  });

  // Once the ticket service is healthy again, paying again completes the order: the customer
  // ends up with exactly the tickets they bought and one payment, not a second charge.
  const retry = await pay(request, orderId);
  expect(retry.status()).toBe(200);
  await expect.poll(() => tickets(orderId), { timeout: 30_000 }).toBe(2);
  expect(status(orderId)).toBe('PAID');
  expect(payments(orderId)).toBe(1);
});
