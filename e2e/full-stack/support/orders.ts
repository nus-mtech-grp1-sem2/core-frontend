import { expect, type APIRequestContext } from '@playwright/test';

import { accessToken } from './auth';
import { configureInventory, startsAt } from './events';
import type { Role } from './users';

/** A call to the API as `role`, with that account's real access token. */
export function callAs(
  request: APIRequestContext,
  role: Role,
  method: 'get' | 'post' | 'put',
  path: string,
  data?: unknown,
) {
  return request[method](path, { headers: { Authorization: `Bearer ${accessToken(role)}` }, data });
}

/** Creates, prices and publishes a general-admission event through the API and returns its id. */
export async function createPublishedGaEvent(
  request: APIRequestContext,
  title: string,
  seats: number,
): Promise<number> {
  const created = await callAs(request, 'organiser', 'post', '/api/event/events', {
    title,
    description: 'API-created for the full-stack e2e suite',
    venue: 'E2E Test Hall',
    startsAt: startsAt(7),
    totalSeats: seats,
    availableBuyers: seats,
    tier: 'TIER1_GA',
  });
  expect(created.status()).toBe(201);
  const { eventId } = (await created.json()) as { eventId: number };
  await configureInventory(request, eventId, { name: 'General admission', price: 5, cols: seats });
  const published = await callAs(
    request,
    'organiser',
    'post',
    `/api/event/events/${eventId}/publish`,
    {},
  );
  expect(published.ok(), `publish -> ${published.status()}`).toBe(true);
  return eventId;
}

export interface Purchase {
  readonly orderId: number;
  readonly qrToken: string;
}

/**
 * Buys one general-admission ticket through the API (create the order, pay, wait for issuance).
 * The order carries `name` and `email`, which is what the door's manual lookup searches.
 */
export async function buyGaTicket(
  request: APIRequestContext,
  role: Role,
  eventId: number,
  person: { readonly name: string; readonly email: string },
): Promise<Purchase> {
  const created = await callAs(request, role, 'post', '/api/order/orders', {
    eventId,
    quantity: 1,
    customerEmail: person.email,
    customerName: person.name,
  });
  expect(created.status(), await created.text()).toBe(201);
  const orderId = ((await created.json()) as { order: { order_id: number } }).order.order_id;

  const paid = await callAs(
    request,
    role,
    'post',
    `/api/order/orders/${orderId}/payment-requests`,
    {
      paymentToken: 'simulated',
    },
  );
  expect(paid.ok(), `pay -> ${paid.status()} ${await paid.text()}`).toBe(true);

  let qrToken = '';
  await expect
    .poll(
      async () => {
        const tickets = await callAs(request, role, 'get', '/api/ticket/customers/me/tickets');
        const list = (
          (await tickets.json()) as { tickets: { order_id: number; qr_token: string }[] }
        ).tickets;
        qrToken = list.find((ticket) => Number(ticket.order_id) === orderId)?.qr_token ?? '';
        return qrToken;
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  return { orderId, qrToken };
}
