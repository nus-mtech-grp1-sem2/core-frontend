import { expect, test, type Page } from '@playwright/test';

import { accessToken, userSub } from './support/auth';
import { configureInventory, createEvent, publishEvent, signedInPage } from './support/events';
import { startFakeCognito, stopFakeCognito, type FakeCognito } from './support/fake-cognito';
import { assertLocalStack, sql } from './support/stack';
import { credentials, type Role } from './support/users';

// The event team: an organiser invites a helper by email, the helper accepts or rejects, and only
// an accepted helper can scan. The event service looks the invitee up in Cognito, which needs AWS
// credentials, so it is pointed at a stand-in that knows the test accounts (support/fake-cognito).
// What that proves is our side of the flow; it does not prove real Cognito's answers.
const runId = Date.now().toString(36);
const TITLE = `E2E Team ${runId}`;

let eventId = 0;
let cognito: FakeCognito;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  assertLocalStack();
  cognito = await startFakeCognito(['organiser', 'helper', 'customer', 'customer2']);
});
test.afterAll(() => stopFakeCognito());

const email = (role: Role) => credentials(role).email;

/** The invitation's state in the database, or null when there is none. */
function membership(role: Role): { id: number; status: string } | null {
  const row = sql(
    `SELECT membership_id, invite_status FROM event_inventory.event_team_memberships
      WHERE event_id = ${Number(eventId)} AND user_sub = '${userSub(role)}'`,
  );
  if (!row) return null;
  const [id, status] = row.split('\t');
  return { id: Number(id), status };
}

const memberRow = (page: Page, role: Role) =>
  page.getByRole('listitem').filter({ hasText: email(role) });

/** Submits the invite form and returns the status the event service answered with. */
async function invite(
  page: Page,
  address: string,
  role: 'Helper' | 'Organizer' = 'Helper',
): Promise<number> {
  await page.getByLabel('Email').fill(address);
  await page.getByLabel('Role').selectOption({ label: role });
  const answered = page.waitForResponse(
    (response) => response.url().includes('/invitations') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  return (await answered).status();
}

const scannerSession = (role: Role, request: Page['request']) =>
  request.post('/api/ticket/scanner/sessions', {
    headers: { Authorization: `Bearer ${accessToken(role)}` },
    data: { eventId },
  });

test('the organiser invites a helper by email and sees the invitation pending', async ({
  browser,
}) => {
  const page = await signedInPage(browser, 'organiser');
  eventId = await createEvent(page, { title: TITLE, tier: 'TIER1_GA' });
  await configureInventory(page.request, eventId, {
    name: 'General admission',
    price: 5,
    cols: 10,
  });
  await publishEvent(page, TITLE);

  await page.goto(`/organiser/events/${eventId}`);
  expect(await invite(page, email('helper'))).toBe(201);

  const row = memberRow(page, 'helper');
  await expect(row).toContainText('Helper · pending');
  // The name on the roster is looked up from Cognito too.
  await expect(row).toContainText('E2E Helper');
  expect(membership('helper')?.status).toBe('PENDING');
  expect(
    cognito.calls().some(({ operation, input }) => {
      return operation === 'ListUsers' && input['Filter'] === `email = "${email('helper')}"`;
    }),
  ).toBe(true);
  await page.context().close();
});

test('a pending invitation grants nothing, and only the invitee can answer it', async ({
  browser,
}) => {
  const helper = await signedInPage(browser, 'helper');
  const pending = membership('helper');
  expect(pending).not.toBeNull();

  // Not on the team yet: the backend refuses a scanner session.
  expect((await scannerSession('helper', helper.request)).status()).toBe(403);

  // Someone else cannot accept it on the helper's behalf.
  const stranger = await signedInPage(browser, 'customer2');
  const stolen = await stranger.request.post(`/api/event/team-invitations/${pending?.id}/accept`, {
    headers: { Authorization: `Bearer ${accessToken('customer2')}` },
  });
  expect(stolen.status()).toBe(404);
  expect(membership('helper')?.status).toBe('PENDING');
  await stranger.context().close();

  await helper.goto('/events');
  const invitation = helper.locator('.invitation').filter({ hasText: TITLE });
  await expect(invitation).toContainText('as helper');
  await invitation.getByRole('button', { name: 'Accept' }).click();

  await expect(invitation).toHaveCount(0);
  expect(membership('helper')?.status).toBe('ACCEPTED');
  await helper.context().close();
});

test('once accepted, the helper is on the roster and can open the door', async ({ browser }) => {
  const organiser = await signedInPage(browser, 'organiser');
  await organiser.goto(`/organiser/events/${eventId}`);
  await expect(memberRow(organiser, 'helper')).toContainText('Helper · accepted');
  await organiser.context().close();

  const helper = await signedInPage(browser, 'helper');
  expect((await scannerSession('helper', helper.request)).status()).toBe(200);
  await helper.goto(`/checkin/${eventId}`);
  await expect(helper.getByRole('status').filter({ hasText: '0 of 0 checked in' })).toBeVisible();
  await helper.context().close();
});

test('a rejected invitation stays rejected and grants nothing', async ({ browser }) => {
  const organiser = await signedInPage(browser, 'organiser');
  await organiser.goto(`/organiser/events/${eventId}`);
  expect(await invite(organiser, email('customer2'))).toBe(201);
  await expect(memberRow(organiser, 'customer2')).toContainText('Helper · pending');

  const invitee = await signedInPage(browser, 'customer2');
  await invitee.goto('/events');
  const invitation = invitee.locator('.invitation').filter({ hasText: TITLE });
  await invitation.getByRole('button', { name: 'Reject' }).click();
  await expect(invitation).toHaveCount(0);
  expect(membership('customer2')?.status).toBe('REJECTED');
  expect((await scannerSession('customer2', invitee.request)).status()).toBe(403);

  // The same invitation cannot be answered a second time.
  const again = await invitee.request.post(
    `/api/event/team-invitations/${membership('customer2')?.id}/accept`,
    { headers: { Authorization: `Bearer ${accessToken('customer2')}` } },
  );
  expect(again.status()).toBe(404);
  expect(membership('customer2')?.status).toBe('REJECTED');

  await organiser.reload();
  await expect(memberRow(organiser, 'customer2')).toContainText('Helper · rejected');
  await invitee.context().close();
  await organiser.context().close();
});

test('inviting an unknown email or someone already invited shows an error and adds nobody', async ({
  browser,
}) => {
  const organiser = await signedInPage(browser, 'organiser');
  await organiser.goto(`/organiser/events/${eventId}`);
  const rows = organiser.locator('.member-list li');
  await expect(memberRow(organiser, 'helper')).toBeVisible();
  const before = await rows.count();

  expect(await invite(organiser, `nobody-${runId}@example.com`)).toBe(404);
  await expect(organiser.getByRole('alert')).toContainText(
    'No OneStage account uses that email. Ask them to sign up first, then invite them again.',
  );
  await expect(rows).toHaveCount(before);

  // The helper is already on the team: a second invitation is refused, not added twice.
  expect(await invite(organiser, email('helper'))).toBe(409);
  await expect(organiser.getByRole('alert')).toContainText(
    "That person is already on this event's team or has a pending invitation.",
  );
  await expect(rows).toHaveCount(before);
  expect(
    sql(`SELECT COUNT(*) FROM event_inventory.event_team_memberships
               WHERE event_id = ${Number(eventId)} AND user_sub = '${userSub('helper')}'`),
  ).toBe('1');
  await organiser.context().close();
});

test('when Cognito is unavailable an invitation fails cleanly and the roster still loads', async ({
  browser,
}) => {
  const organiser = await signedInPage(browser, 'organiser');
  cognito.setFailing(true);
  try {
    await organiser.goto(`/organiser/events/${eventId}`);
    expect(await invite(organiser, email('customer'))).toBe(502);
    await expect(organiser.getByRole('alert')).toContainText(
      'Unable to send the invitation. Please try again.',
    );
    expect(membership('customer')).toBeNull();

    // Names come from Cognito, so they are missing, but the team is still listed by email.
    await organiser.reload();
    await expect(memberRow(organiser, 'helper')).toContainText('Helper · accepted');
    await expect(memberRow(organiser, 'helper')).not.toContainText('E2E Helper');
  } finally {
    cognito.setFailing(false);
  }

  // And it recovers: the same invitation now goes through.
  await organiser.reload();
  expect(await invite(organiser, email('customer'))).toBe(201);
  await expect(memberRow(organiser, 'customer')).toContainText('Helper · pending');
  expect(membership('customer')?.status).toBe('PENDING');
  await organiser.context().close();
});
