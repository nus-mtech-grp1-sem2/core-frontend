import { expect, test } from '@playwright/test';

import { accessToken, userSub } from './support/auth';
import {
  configureInventory,
  createEvent,
  publishEvent,
  setAvailableBuyers,
  signedInPage,
} from './support/events';
import { assertLocalStack, sql, withQueueSettings } from './support/stack';
import type { Role } from './support/users';

// The rest of this tier runs the queue service with automatic admission off, so the tests decide
// when customers get in. Production runs with it on: a scheduler admits people as the interval
// allows and expires admissions nobody used. This spec recreates the queue service with the
// scheduler on for its own duration, then puts it back.
const runId = Date.now().toString(36);
const TITLE = `E2E Auto Admission ${runId}`;

const INTERVAL_SEC = 15;
const TOKEN_TTL_SEC = 8; // shorter than the interval, so "slot freed" and "interval" are told apart

test.beforeAll(() => assertLocalStack());

/** The queue entry of `role` for the event: its status and when it was admitted, in epoch seconds. */
function entry(eventId: number, role: Role): { status: string; admittedAt: number | null } {
  const [status = '', admittedAt = 'NULL'] = sql(
    `SELECT e.status, UNIX_TIMESTAMP(e.admitted_at) FROM queue.queue_entries e
       JOIN queue.queue_sessions s ON s.queue_session_id = e.queue_session_id
      WHERE s.event_id = ${Number(eventId)} AND e.customer_sub = '${userSub(role)}'`,
  ).split('\t');
  return { status, admittedAt: admittedAt === 'NULL' ? null : Number(admittedAt) };
}

test('the scheduler admits customers on its own, one at a time, and an unused admission expires', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // Set up a reserved event that lets one buyer in at a time.
  const organiser = await signedInPage(browser, 'organiser');
  const eventId = await createEvent(organiser, { title: TITLE, tier: 'TIER2_SEATED' });
  await configureInventory(organiser.request, eventId, { name: 'Stalls', price: 8, cols: 4 });
  await setAvailableBuyers(organiser.request, eventId, 1);
  await publishEvent(organiser, TITLE);

  // Open the waiting room through the API with a short interval ("Open waiting room" in the UI
  // always uses 60 seconds, which is covered by the other specs).
  const opened = await organiser.request.put(`/api/queue/events/${eventId}/queue/config`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
    data: {
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      admissionBatchSize: 1,
      admissionIntervalSec: INTERVAL_SEC,
    },
  });
  expect(opened.ok(), `queue config PUT -> ${opened.status()} ${await opened.text()}`).toBe(true);
  await organiser.context().close();

  await withQueueSettings(
    {
      AUTO_ADMISSION_ENABLED: 'true',
      ADMISSION_TOKEN_TTL_SEC: String(TOKEN_TTL_SEC),
      ADMISSION_SCHEDULER_POLL_MS: '1000',
    },
    async () => {
      const first = await signedInPage(browser, 'customer');
      const second = await signedInPage(browser, 'customer2');
      const joined = async (page: typeof first) => {
        await page.goto(`/events/${eventId}`);
        await page.getByRole('button', { name: 'Join waiting room' }).click();
        await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
      };

      // Nobody presses "Admit next customer": the first customer is admitted by the scheduler and
      // the queue page moves them on to choose seats.
      await joined(first);
      await first.waitForURL(new RegExp(`/events/${eventId}$`), { timeout: 30_000 });
      await expect(first.getByText('It is your turn.')).toBeVisible();
      expect(entry(eventId, 'customer').status).toBe('ADMITTED');

      // One buyer at a time: with the first admission still live, the second customer waits.
      await joined(second);
      await expect(second.locator('.position strong')).toHaveText('1');
      expect(entry(eventId, 'customer2').status).toBe('WAITING');

      // The first customer never buys. Their admission expires and the slot is freed...
      await expect
        .poll(() => entry(eventId, 'customer').status, { timeout: 60_000 })
        .toBe('EXPIRED');
      // ...but the interval since the last admission has not passed, so the second still waits.
      expect(entry(eventId, 'customer2').status).toBe('WAITING');

      // Once it has, the scheduler admits the second customer, whose page moves on.
      await second.waitForURL(new RegExp(`/events/${eventId}$`), { timeout: 60_000 });
      await expect(second.getByText('It is your turn.')).toBeVisible();
      const firstAdmittedAt = entry(eventId, 'customer').admittedAt;
      const secondAdmittedAt = entry(eventId, 'customer2').admittedAt;
      expect(firstAdmittedAt).not.toBeNull();
      expect(secondAdmittedAt).not.toBeNull();
      // Timestamps are whole seconds, so allow one second of rounding either side.
      expect((secondAdmittedAt ?? 0) - (firstAdmittedAt ?? 0)).toBeGreaterThanOrEqual(
        INTERVAL_SEC - 1,
      );
      expect(entry(eventId, 'customer2').status).toBe('ADMITTED');

      for (const page of [first, second]) await page.context().close();
    },
  );
});
