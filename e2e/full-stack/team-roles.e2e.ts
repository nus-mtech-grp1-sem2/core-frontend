import { expect, test, type Page } from '@playwright/test';

import { accessToken, userSub } from './support/auth';
import { signedInPage } from './support/events';
import { startFakeCognito, stopFakeCognito } from './support/fake-cognito';
import { callAs, createPublishedGaEvent } from './support/orders';
import { assertLocalStack, sql } from './support/stack';
import { credentials } from './support/users';

// What an event's team members may do once they are on it: the owner promotes, demotes and removes
// them, and what each role can and cannot do follows. Invitations look users up in Cognito, so the
// event service is pointed at the stand-in (support/fake-cognito) for this spec.
const runId = Date.now().toString(36);

let eventId = 0;
let membershipId = 0;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  assertLocalStack();
  await startFakeCognito(['organiser', 'customer2']);
});
test.afterAll(() => stopFakeCognito());

const member = () =>
  sql(
    `SELECT role, invite_status FROM event_inventory.event_team_memberships
      WHERE event_id = ${eventId} AND user_sub = '${userSub('customer2')}'`,
  );
const memberRow = (page: Page) =>
  page.getByRole('listitem').filter({ hasText: credentials('customer2').email });
const ownerRow = (page: Page) => page.getByRole('listitem').filter({ hasText: 'E2E Organiser' });
const teamStatus = async (page: Page) =>
  (
    await callAs(page.request, 'customer2', 'get', `/api/event/events/${eventId}/team-members`)
  ).status();

test('the owner is on the roster with no actions on their own row', async ({ browser }) => {
  const page = await signedInPage(browser, 'organiser');
  eventId = await createPublishedGaEvent(page.request, `E2E Team Roles ${runId}`, 5);

  await page.goto(`/organiser/events/${eventId}`);
  // The owner's membership row is created with no email, so the roster knows them by name only.
  const own = ownerRow(page);
  await expect(own).toContainText('E2E Organiser');
  await expect(own).toContainText('Organizer · accepted');
  await expect(own.getByRole('button')).toHaveCount(0);
  await expect(page.getByText('You own this event and can remove other organizers.')).toBeVisible();

  // Nobody, the owner included, can change or remove their own membership through the API.
  const self = userSub('organiser');
  const patch = await page.request.patch(`/api/event/events/${eventId}/team-members/${self}`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
    data: { role: 'HELPER' },
  });
  expect(patch.status()).toBe(400);
  const removal = await page.request.delete(`/api/event/events/${eventId}/team-members/${self}`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
  });
  expect(removal.status()).toBe(400);
  await page.context().close();
});

test('a helper, once accepted, has no say over the event', async ({ browser }) => {
  const page = await signedInPage(browser, 'organiser');
  const invited = await callAs(
    page.request,
    'organiser',
    'post',
    `/api/event/events/${eventId}/invitations`,
    {
      email: credentials('customer2').email,
      role: 'HELPER',
    },
  );
  expect(invited.status()).toBe(201);
  membershipId = Number(
    sql(
      `SELECT membership_id FROM event_inventory.event_team_memberships
        WHERE event_id = ${eventId} AND user_sub = '${userSub('customer2')}'`,
    ),
  );
  const accepted = await callAs(
    page.request,
    'customer2',
    'post',
    `/api/event/team-invitations/${membershipId}/accept`,
    {},
  );
  expect(accepted.status()).toBe(204);

  await page.goto(`/organiser/events/${eventId}`);
  await expect(memberRow(page)).toContainText('Helper · accepted');
  // A helper may scan, but the roster and the event's controls are for organisers.
  expect(await teamStatus(page)).toBe(403);
  expect(
    (
      await callAs(page.request, 'customer2', 'post', '/api/ticket/scanner/sessions', { eventId })
    ).status(),
  ).toBe(200);

  const helper = await signedInPage(browser, 'customer2');
  await helper.goto(`/organiser/events/${eventId}`);
  await expect(helper.getByRole('heading', { name: `E2E Team Roles ${runId}` })).toBeVisible();
  await expect(helper.getByRole('region', { name: 'Event management' })).toHaveCount(0);
  await helper.context().close();
  await page.context().close();
});

test('promoting a helper makes them an organiser, but not an owner', async ({ browser }) => {
  const page = await signedInPage(browser, 'organiser');
  await page.goto(`/organiser/events/${eventId}`);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe(`Promote ${credentials('customer2').email} to Organizer?`);
    void dialog.accept();
  });
  await memberRow(page).getByRole('button', { name: 'Promote to organizer' }).click();
  await expect(memberRow(page)).toContainText('Organizer · accepted');
  expect(member()).toBe('ORGANISER\tACCEPTED');

  // The new organiser can now see the roster and the event's controls...
  expect(await teamStatus(page)).toBe(200);
  const promoted = await signedInPage(browser, 'customer2');
  await promoted.goto(`/organiser/events/${eventId}`);
  const region = promoted.getByRole('region', { name: 'Event management' });
  await expect(region).toBeVisible();
  // ...but cannot promote or demote anyone, or remove another organiser (the owner).
  await expect(promoted.getByRole('button', { name: /Promote|Demote/ })).toHaveCount(0);
  await expect(
    promoted
      .getByRole('listitem')
      .filter({ hasText: credentials('organiser').email })
      .getByRole('button'),
  ).toHaveCount(0);
  await expect(promoted.getByText('You own this event')).toHaveCount(0);

  const asPromoted = { Authorization: `Bearer ${accessToken('customer2')}` };
  const demoteOwner = await promoted.request.patch(
    `/api/event/events/${eventId}/team-members/${userSub('organiser')}`,
    { headers: asPromoted, data: { role: 'HELPER' } },
  );
  expect(demoteOwner.status()).toBe(403);
  expect(((await demoteOwner.json()) as { error: string }).error).toBe('event_owner_required');
  const removeOwner = await promoted.request.delete(
    `/api/event/events/${eventId}/team-members/${userSub('organiser')}`,
    { headers: asPromoted },
  );
  expect(removeOwner.status()).toBe(403);
  expect(((await removeOwner.json()) as { error: string }).error).toBe('event_owner_required');
  await promoted.context().close();
  await page.context().close();
});

test('demoting takes the organiser powers away again', async ({ browser }) => {
  const page = await signedInPage(browser, 'organiser');
  await page.goto(`/organiser/events/${eventId}`);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe(`Demote ${credentials('customer2').email} to Helper?`);
    void dialog.accept();
  });
  await memberRow(page).getByRole('button', { name: 'Demote to helper' }).click();
  await expect(memberRow(page)).toContainText('Helper · accepted');
  expect(member()).toBe('HELPER\tACCEPTED');

  expect(await teamStatus(page)).toBe(403);
  await page.context().close();
});

test('removing a helper takes them off the team and takes away their access', async ({
  browser,
}) => {
  const page = await signedInPage(browser, 'organiser');
  await page.goto(`/organiser/events/${eventId}`);

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe(`Remove ${credentials('customer2').email} from this event?`);
    void dialog.dismiss();
  });
  await memberRow(page).getByRole('button', { name: 'Remove' }).click();
  await expect(memberRow(page)).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await memberRow(page).getByRole('button', { name: 'Remove' }).click();
  await expect(memberRow(page)).toHaveCount(0);
  expect(member()).toBe('');
  expect(
    (
      await callAs(page.request, 'customer2', 'post', '/api/ticket/scanner/sessions', { eventId })
    ).status(),
  ).toBe(403);
  await page.context().close();
});

test('the owner is listed with their email like everyone else', async ({ browser }) => {
  test.fail(
    true,
    'Known bug (backend-repo#88): the owner\'s membership row is created with an empty email, so the roster shows "E2E Organiser — " with nothing after the dash',
  );
  const page = await signedInPage(browser, 'organiser');
  await page.goto(`/organiser/events/${eventId}`);

  await expect(ownerRow(page)).toContainText(credentials('organiser').email);
  await page.context().close();
});
