import { expect, test } from '@playwright/test';

import { userSub } from './support/auth';
import { buyGaTicket, callAs, createPublishedGaEvent } from './support/orders';
import { admit } from './support/queue';
import { assertLocalStack, sql } from './support/stack';
import { credentials } from './support/users';

const runId = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

test('tickets that are already held cannot be sold again', async ({ request }) => {
  // The queue admits no more buyers than there are tickets, so two tickets let both customers in
  // together; the first then holds every ticket and the order service must refuse the second.
  const eventId = await createPublishedGaEvent(request, `E2E Sold Out ${runId}`, 2);
  const tokens = await admit(request, eventId, ['customer', 'customer2']);
  const order = (role: 'customer' | 'customer2', quantity: number) =>
    callAs(request, role, 'post', '/api/order/orders', {
      eventId,
      quantity,
      admissionToken: tokens[role],
      customerEmail: 'buyer@example.com',
      customerName: 'E2E Buyer',
    });

  const first = await order('customer', 2);
  expect(first.status()).toBe(201);

  const second = await order('customer2', 1);
  expect(second.status()).toBe(409);
  expect(((await second.json()) as { error: string }).error).toBe('inventory_unavailable');

  // The two tickets are held, not double-counted, and stock never goes negative.
  const [total, reserved, sold] = sql(
    `SELECT total_qty, reserved_qty, sold_qty FROM event_inventory.inventory_items WHERE event_id = ${eventId}`,
  )
    .split('\t')
    .map(Number);
  expect(total).toBe(2);
  expect(reserved + sold).toBe(2);
  expect(Math.min(total, reserved, sold)).toBeGreaterThanOrEqual(0);
});

test('the same ticket scanned at the same moment is accepted once', async ({ request }) => {
  const eventId = await createPublishedGaEvent(request, `E2E Door Race ${runId}`, 5);
  sql(
    `INSERT INTO event_inventory.event_team_memberships
       (event_id, user_sub, user_email, role, invite_status, granted_by_sub)
     VALUES (${eventId}, '${userSub('helper')}', '${credentials('helper').email}',
             'HELPER', 'ACCEPTED', '${userSub('organiser')}')`,
  );
  // One queue place buys one order, so the two tickets are bought by two customers.
  const tokens = await admit(request, eventId, ['customer', 'customer2']);
  const [one, two] = await Promise.all([
    buyGaTicket(
      request,
      'customer',
      eventId,
      { name: 'A', email: 'a@example.com' },
      tokens.customer,
    ),
    buyGaTicket(
      request,
      'customer2',
      eventId,
      { name: 'B', email: 'b@example.com' },
      tokens.customer2,
    ),
  ]);

  // Two helpers scanning at once each have their own scanner session; one is enough here.
  const session = await callAs(request, 'helper', 'post', '/api/ticket/scanner/sessions', {
    eventId,
  });
  const { sessionToken } = (await session.json()) as { sessionToken: string };
  const scan = async (qrToken: string) => {
    const response = await request.post('/api/ticket/tickets/validate', {
      headers: { Authorization: `Bearer ${sessionToken}` },
      data: { qrToken },
    });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { outcome: string }).outcome;
  };

  const outcomes = await Promise.all([scan(one.qrToken), scan(one.qrToken), scan(two.qrToken)]);

  // The contested ticket is accepted exactly once and reported as a duplicate the other time;
  // the other ticket is independent and accepted.
  expect(outcomes.slice(0, 2).sort()).toEqual(['DUPLICATE', 'SUCCESS']);
  expect(outcomes[2]).toBe('SUCCESS');
  expect(
    sql(
      `SELECT COUNT(*) FROM ticketing.tickets WHERE event_id = ${eventId} AND status = 'CHECKED_IN'`,
    ),
  ).toBe('2');
});
