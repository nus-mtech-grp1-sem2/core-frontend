import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { accessToken, userSub } from './support/auth';
import { payAtCheckout } from './support/checkout';
import {
  configureInventory,
  createEvent,
  publishEvent,
  setAvailableBuyers,
  signedInPage,
} from './support/events';
import { assertLocalStack, sql } from './support/stack';
import { startsAt } from './support/events';
import type { Role } from './support/users';

// One reserved-seating event, two customers, run in order: the waiting room, a real seat race and
// checkout. The title carries a run id because the local database keeps events between runs.
const runId = Date.now().toString(36);
const TITLE = `E2E Reserved Seating ${runId}`;

let eventId = 0;
let seatLabels: string[] = [];

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => assertLocalStack());

const position = (page: Page) => page.locator('.position strong');

test('organiser publishes a reserved-seating event and opens the waiting room', async ({
  browser,
}) => {
  const page = await signedInPage(browser, 'organiser');
  // Two available buyers means one "Admit next customer" admits up to two people together.
  eventId = await createEvent(page, {
    title: TITLE,
    tier: 'TIER2_SEATED',
  });
  await configureInventory(page.request, eventId, { name: 'Stalls', price: 8, cols: 4 });
  await setAvailableBuyers(page.request, eventId, 2);
  await publishEvent(page, TITLE);

  const inventory = await page.request.get(`/api/inventory/events/${eventId}/inventory`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
  });
  expect(inventory.ok(), `inventory GET -> ${inventory.status()} ${await inventory.text()}`).toBe(
    true,
  );
  const { seats } = (await inventory.json()) as { seats: { seatLabel: string }[] };
  seatLabels = seats.map((seat) => seat.seatLabel);
  expect(seatLabels).toHaveLength(4);

  await page.goto(`/organiser/events/${eventId}`);
  await page.getByRole('button', { name: 'Open waiting room', exact: true }).click();
  await expect(page.getByText('Open · 0 waiting · up to 2 active buyers')).toBeVisible();
  await page.context().close();
});

test('customers queue in order, rejoining keeps one place, and the organiser admits them', async ({
  browser,
}) => {
  const first = await signedInPage(browser, 'customer');
  const second = await signedInPage(browser, 'customer2');
  const organiser = await signedInPage(browser, 'organiser');

  for (const [page, expected] of [
    [first, '1'],
    [second, '2'],
  ] as const) {
    await page.goto(`/events/${eventId}`);
    await page.getByRole('button', { name: 'Join waiting room' }).click();
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    await expect(position(page)).toHaveText(expected);
  }

  // Idempotency: reloading (which joins again) must not add a second entry or move the customer.
  await first.reload();
  await expect(position(first)).toHaveText('1');
  const entries = sql(
    `SELECT COUNT(*) FROM queue.queue_entries e
       JOIN queue.queue_sessions s ON s.queue_session_id = e.queue_session_id
      WHERE s.event_id = ${Number(eventId)} AND e.customer_sub = '${userSub('customer')}'`,
  );
  expect(entries).toBe('1');

  await organiser.goto(`/organiser/events/${eventId}`);
  await expect(organiser.getByText('Open · 2 waiting · up to 2 active buyers')).toBeVisible();
  await organiser.getByRole('button', { name: 'Admit next customer' }).click();
  await expect(organiser.getByText('Open · 0 waiting')).toBeVisible();

  // The queue pages poll every few seconds and then send each customer to seat selection.
  for (const page of [first, second]) {
    await page.waitForURL(new RegExp(`/events/${eventId}$`), { timeout: 30_000 });
    await expect(page.getByText('It is your turn.')).toBeVisible();
  }
  for (const page of [first, second, organiser]) await page.context().close();
});

test('two admitted customers race for one seat: exactly one gets it, the other picks another', async ({
  browser,
}) => {
  const first = await signedInPage(browser, 'customer');
  const second = await signedInPage(browser, 'customer2');
  const seat = (page: Page, label: string) =>
    page.getByRole('button', { name: new RegExp(`^${label} —`) });

  for (const page of [first, second]) {
    await page.goto(`/events/${eventId}`);
    await expect(page.getByText('It is your turn.')).toBeVisible();
    await seat(page, seatLabels[0]).click();
  }

  // Both submit at the same moment.
  await Promise.all([
    first.getByRole('button', { name: 'Buy tickets' }).click(),
    second.getByRole('button', { name: 'Buy tickets' }).click(),
  ]);
  await expect
    .poll(
      async () =>
        [first, second].filter((page) => /\/checkout\/\d+/.test(page.url())).length +
        (await Promise.all([first, second].map((page) => page.getByRole('alert').count()))).reduce(
          (total, count) => total + count,
          0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);

  const winners = [first, second].filter((page) => /\/checkout\/\d+/.test(page.url()));
  const losers = [first, second].filter((page) => !winners.includes(page));
  expect(winners, 'exactly one customer gets the seat').toHaveLength(1);
  expect(losers).toHaveLength(1);
  const [winner] = winners;
  const [loser] = losers;
  await expect(loser.getByRole('alert').first()).toContainText(
    'Tickets are currently unavailable or sold out. Refresh the event before trying again.',
  );

  // The seat is held for the winner during checkout, so it is no longer offered to anyone.
  await loser.reload();
  await expect(seat(loser, seatLabels[0])).toBeDisabled();

  // The loser is still admitted and takes a different seat.
  await seat(loser, seatLabels[1]).click();
  await loser.getByRole('button', { name: 'Buy tickets' }).click();

  await Promise.all([payAtCheckout(winner), payAtCheckout(loser)]);
  for (const page of [winner, loser]) await page.waitForURL(/\/my-events/, { timeout: 60_000 });

  await expect(winner.getByRole('article').filter({ hasText: TITLE })).toContainText(
    seatLabels[0],
    { timeout: 60_000 },
  );
  await expect(loser.getByRole('article').filter({ hasText: TITLE })).toContainText(seatLabels[1], {
    timeout: 60_000,
  });

  // Two tickets, two different seats: nothing was issued twice.
  expect(
    sql(
      `SELECT COUNT(*), COUNT(DISTINCT seat_id) FROM ticketing.tickets WHERE event_id = ${Number(eventId)}`,
    ),
  ).toBe('2\t2');
  for (const page of [first, second]) await page.context().close();
});

test.describe('admission token and order input safety (API level)', () => {
  let apiEventId = 0;
  let seatIds: number[] = [];
  const tokens: Partial<Record<Role, string>> = {};

  const call = (
    request: APIRequestContext,
    role: Role,
    method: 'get' | 'post' | 'put',
    path: string,
    data?: unknown,
  ) =>
    request[method](path, {
      headers: { Authorization: `Bearer ${accessToken(role)}` },
      data,
    });

  const orderBody = (seatId: number, admissionToken?: string) => ({
    eventId: apiEventId,
    quantity: 1,
    seatIds: [seatId],
    admissionToken,
    customerEmail: 'e2e@example.com',
    customerName: 'E2E',
  });

  const ordersFor = (role: Role) =>
    Number(
      sql(
        `SELECT COUNT(*) FROM checkout.orders WHERE event_id = ${apiEventId} AND customer_sub = '${userSub(role)}'`,
      ),
    );

  test.beforeAll(async ({ request }) => {
    const created = await call(request, 'organiser', 'post', '/api/event/events', {
      title: `E2E Token Safety ${runId}`,
      description: 'API-level checks',
      venue: 'E2E Test Hall',
      startsAt: startsAt(7),
      tier: 'TIER2_SEATED',
    });
    expect(created.status()).toBe(201);
    apiEventId = ((await created.json()) as { eventId: number }).eventId;
    await configureInventory(request, apiEventId, { name: 'Stalls', price: 8, cols: 4 });
    await setAvailableBuyers(request, apiEventId, 2);
    expect(
      (
        await call(request, 'organiser', 'post', `/api/event/events/${apiEventId}/publish`, {})
      ).ok(),
    ).toBe(true);
    expect(
      (
        await call(request, 'organiser', 'put', `/api/queue/events/${apiEventId}/queue/config`, {
          opensAt: new Date().toISOString(),
          admissionBatchSize: 2,
          admissionIntervalSec: 60,
        })
      ).ok(),
    ).toBe(true);
    for (const role of ['customer', 'customer2'] as const) {
      const joined = await call(
        request,
        role,
        'post',
        `/api/queue/events/${apiEventId}/queue/join`,
        {},
      );
      expect(joined.ok(), `join ${role}`).toBe(true);
    }
    const admitted = await call(
      request,
      'organiser',
      'post',
      `/api/queue/events/${apiEventId}/queue/admit-next`,
      {},
    );
    expect(admitted.ok()).toBe(true);
    for (const role of ['customer', 'customer2'] as const) {
      const me = await call(request, role, 'get', `/api/queue/events/${apiEventId}/queue/me`);
      const status = (await me.json()) as { status: string; admissionToken?: string };
      expect(status.status).toBe('ADMITTED');
      tokens[role] = status.admissionToken;
    }
    const inventory = await call(
      request,
      'organiser',
      'get',
      `/api/inventory/events/${apiEventId}/inventory`,
    );
    seatIds = ((await inventory.json()) as { seats: { seatId: number }[] }).seats.map(
      (seat) => seat.seatId,
    );
  });

  const refused = async (
    response: Awaited<ReturnType<typeof call>>,
    status: number,
    code: string,
  ) => {
    expect(response.status()).toBe(status);
    expect(((await response.json()) as { error: string }).error).toBe(code);
  };

  test('an admission token buys once and cannot be reused for a second order', async ({
    request,
  }) => {
    const first = await call(
      request,
      'customer',
      'post',
      '/api/order/orders',
      orderBody(seatIds[0], tokens.customer),
    );
    expect(first.status()).toBe(201);

    const second = await call(
      request,
      'customer',
      'post',
      '/api/order/orders',
      orderBody(seatIds[1], tokens.customer),
    );
    await refused(second, 403, 'queue_admission_required');
    expect(ordersFor('customer')).toBe(1);
  });

  test('an expired admission token is refused', async ({ request }) => {
    sql(
      `UPDATE queue.queue_entries e JOIN queue.queue_sessions s ON s.queue_session_id = e.queue_session_id
          SET e.token_expires_at = NOW() - INTERVAL 1 MINUTE
        WHERE s.event_id = ${apiEventId} AND e.customer_sub = '${userSub('customer2')}'`,
    );
    const late = await call(
      request,
      'customer2',
      'post',
      '/api/order/orders',
      orderBody(seatIds[2], tokens.customer2),
    );
    await refused(late, 403, 'queue_admission_required');
    expect(ordersFor('customer2')).toBe(0);
  });

  test('malformed orders are rejected and create nothing', async ({ request }) => {
    const invalid: Record<string, unknown> = {
      'quantity 0': { ...orderBody(seatIds[3], tokens.customer2), quantity: 0 },
      'a quantity above the limit': { ...orderBody(seatIds[3], tokens.customer2), quantity: 1000 },
      'a missing event id': { ...orderBody(seatIds[3], tokens.customer2), eventId: undefined },
      'malformed seat ids': { ...orderBody(seatIds[3], tokens.customer2), seatIds: ['x', -1] },
    };
    for (const [name, body] of Object.entries(invalid)) {
      const response = await call(request, 'customer2', 'post', '/api/order/orders', body);
      expect(response.status(), name).toBe(400);
      expect(((await response.json()) as { error: string }).error, name).toBe('invalid_order');
    }

    // A well-formed order still needs a waiting-room admission on a reserved-seating event.
    const noToken = await call(
      request,
      'customer2',
      'post',
      '/api/order/orders',
      orderBody(seatIds[3]),
    );
    await refused(noToken, 403, 'queue_admission_required');
    expect(ordersFor('customer2')).toBe(0);
  });
});
