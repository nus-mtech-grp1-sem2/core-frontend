import type { Dialog, Page } from '@playwright/test';

import type { MockApi } from './support/api';
import { managedEvent } from './support/data';
import { expect, test } from './support/fixtures';
import { customer, organiser, signInAs } from './support/session';

const EVENT_ID = 7;
const OTHER_ORGANISER = '00000000-0000-4000-8000-0000000000aa';
const HELPER_SUB = '00000000-0000-4000-8000-0000000000bb';

/** A 1x1 PNG, enough for the app to treat as an image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Member {
  membership_id: number;
  user_sub: string;
  user_email: string;
  role: 'ORGANISER' | 'HELPER';
  invite_status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  name?: string;
}

const owner: Member = {
  membership_id: 1,
  user_sub: organiser.sub,
  user_email: organiser.email,
  role: 'ORGANISER',
  invite_status: 'ACCEPTED',
  name: 'Olive Organiser',
};
const coOrganiser: Member = {
  membership_id: 2,
  user_sub: OTHER_ORGANISER,
  user_email: 'second.host@example.test',
  role: 'ORGANISER',
  invite_status: 'ACCEPTED',
};
const helperMember: Member = {
  membership_id: 3,
  user_sub: HELPER_SUB,
  user_email: 'helper-on-team@example.test',
  role: 'HELPER',
  invite_status: 'ACCEPTED',
};

/** The event as the service returns it; tests change fields to move it through its life. */
function stubEvent(
  api: MockApi,
  event: Record<string, unknown> = {},
  members: Member[] = [owner, coOrganiser, helperMember],
) {
  const state = {
    event: {
      ...managedEvent({ status: 'DRAFT', description: 'A night of music' }),
      organiser_sub: organiser.sub,
      ...event,
    },
    members,
  };
  api
    .on('GET', `event/events/${EVENT_ID}`, () => ({ json: { event: state.event } }))
    .on('GET', `event/events/${EVENT_ID}/team-members`, () => ({
      json: { members: state.members },
    }))
    .on('GET', `inventory/events/${EVENT_ID}/inventory`, {
      json: {
        gridRows: 1,
        gridCols: 4,
        zones: [{ inventoryItemId: 1, seatCount: 4, soldCount: 2, heldCount: 0 }],
        seats: [{}, {}, {}, {}],
      },
    })
    .on('GET', `ticket/events/${EVENT_ID}/checkin-stats`, { json: { checkedIn: 1, issued: 2 } })
    .on('GET', `event/events/${EVENT_ID}/cancellation-impact`, {
      json: { eventId: EVENT_ID, customers: 0, ticketsSold: 0, requiresConfirmation: false },
    })
    .on('GET', 'event/events/manage', () => ({ json: { events: [state.event] } }));
  return state;
}

const dialogs: string[] = [];
/** Answers the next confirmation prompt, remembering what it asked. */
function answerNext(page: Page, accept: boolean) {
  page.once('dialog', async (dialog: Dialog) => {
    dialogs.push(dialog.message());
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
}

const management = (page: Page) => page.getByRole('region', { name: 'Event management' });
/** The app's own confirmation dialog, used in place of window.confirm for cancelling an event. */
const confirmation = (page: Page) => page.getByRole('dialog');
const row = (page: Page, email: string) => page.getByRole('listitem').filter({ hasText: email });

test.beforeEach(async ({ page }) => {
  dialogs.length = 0;
  await signInAs(page, organiser);
});

test.describe('editing a draft', () => {
  test('changes are saved with the whole form and the page shows what was saved', async ({
    page,
    api,
  }) => {
    const state = stubEvent(api);
    api.on('PUT', `event/events/${EVENT_ID}`, (request) => {
      state.event = { ...state.event, ...(request.postDataJSON() as object) };
      return { status: 204 };
    });
    await page.goto(`/organiser/events/${EVENT_ID}`);
    await expect(page.getByLabel('Title')).toHaveValue('E2E Summer Concert');

    await page.getByLabel('Title').fill('Renamed Concert');
    await page.getByLabel('Venue').fill('New Hall');
    await page.getByLabel('Description').fill('Now with fireworks');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('heading', { name: 'Renamed Concert' })).toBeVisible();
    const [save] = api.requests('PUT', `event/events/${EVENT_ID}`);
    expect(save.postDataJSON()).toMatchObject({
      title: 'Renamed Concert',
      venue: 'New Hall',
      description: 'Now with fireworks',
      tier: 'TIER1_GA',
    });
    await expect(page.getByLabel('Venue')).toHaveValue('New Hall');
  });

  test('a form with a blank title or venue is not sent', async ({ page, api }) => {
    stubEvent(api);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByLabel('Title').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByLabel('Title').fill('Fine');
    await page.getByLabel('Venue').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();

    expect(api.requests('PUT', `event/events/${EVENT_ID}`)).toHaveLength(0);
  });

  test('total seats come from the inventory, so they cannot be typed in', async ({ page, api }) => {
    stubEvent(api);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByLabel('Total seats')).toBeDisabled();
    await expect(page.getByText('Set by the zones in Configure inventory.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Configure inventory' })).toHaveAttribute(
      'href',
      `/organiser/events/${EVENT_ID}/inventory`,
    );
  });

  test('the service refusing an edit is explained', async ({ page, api }) => {
    stubEvent(api);
    api.on('PUT', `event/events/${EVENT_ID}`, {
      status: 409,
      json: { error: 'event_not_editable' },
    });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(management(page).getByRole('alert')).toContainText(
      'This event has already been published',
    );
  });
});

test.describe('the event photo', () => {
  test('a picked photo is previewed, and uploaded with its type when saved', async ({
    page,
    api,
  }) => {
    stubEvent(api);
    api
      .on('PUT', `event/events/${EVENT_ID}`, { status: 204 })
      .on('PUT', `event/events/${EVENT_ID}/image`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByLabel('Event photo').setInputFiles({
      name: 'poster.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(
      page.getByRole('img', { name: 'Preview of the selected event cover' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      page.getByRole('img', { name: 'Preview of the selected event cover' }),
    ).toHaveCount(0);
    const [upload] = api.requests('PUT', `event/events/${EVENT_ID}/image`);
    const body = upload.postDataJSON() as { imageBase64: string; mimeType: string };
    expect(body.mimeType).toBe('image/png');
    expect(body.imageBase64).toContain(PNG.toString('base64'));
  });

  test('a file that is not JPEG, PNG or WebP is refused', async ({ page, api }) => {
    stubEvent(api);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByLabel('Event photo').setInputFiles({
      name: 'poster.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });

    await expect(management(page).getByRole('alert')).toContainText(
      'Please choose a JPEG, PNG or WebP image.',
    );
    await expect(
      page.getByRole('img', { name: 'Preview of the selected event cover' }),
    ).toHaveCount(0);
  });

  test('a photo over 5 MB is refused', async ({ page, api }) => {
    stubEvent(api);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByLabel('Event photo').setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });

    await expect(management(page).getByRole('alert')).toContainText(
      'Image must be 5MB or smaller.',
    );
  });
});

test.describe('deleting a draft', () => {
  test('is confirmed first, and then the draft is gone', async ({ page, api }) => {
    stubEvent(api);
    api.on('DELETE', `event/events/${EVENT_ID}`, { status: 204 });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    answerNext(page, false);
    await page.getByRole('button', { name: 'Delete draft' }).click();
    await expect(page).toHaveURL(new RegExp(`/organiser/events/${EVENT_ID}$`));
    expect(api.requests('DELETE', `event/events/${EVENT_ID}`)).toHaveLength(0);

    answerNext(page, true);
    await page.getByRole('button', { name: 'Delete draft' }).click();
    await page.waitForURL('**/organiser/events');
    expect(api.requests('DELETE', `event/events/${EVENT_ID}`)).toHaveLength(1);
    expect(dialogs).toEqual([
      'Delete this draft event? This cannot be undone.',
      'Delete this draft event? This cannot be undone.',
    ]);
  });

  test('an event with reservation history cannot be deleted, and the page says why', async ({
    page,
    api,
  }) => {
    stubEvent(api);
    api.on('DELETE', `event/events/${EVENT_ID}`, {
      status: 409,
      json: { error: 'event_has_reservation_history' },
    });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    answerNext(page, true);
    await page.getByRole('button', { name: 'Delete draft' }).click();

    await expect(management(page).getByRole('alert')).toContainText('has reservation history');
    await expect(page).toHaveURL(new RegExp(`/organiser/events/${EVENT_ID}$`));
  });
});

test.describe('an event moving through its life', () => {
  test('published: details lock, it cannot be deleted, and it can be cancelled and re-published', async ({
    page,
    api,
  }) => {
    const state = stubEvent(api, { status: 'PUBLISHED' });
    api
      .on('POST', `event/events/${EVENT_ID}/cancel`, () => {
        state.event = { ...state.event, status: 'CANCELLED' };
        return { status: 204 };
      })
      .on('POST', `event/events/${EVENT_ID}/publish`, () => {
        state.event = { ...state.event, status: 'PUBLISHED' };
        return { status: 204 };
      });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByText('This event has already been published')).toBeVisible();
    await expect(page.getByLabel('Title')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete draft' })).toHaveCount(0);
    await expect(page.getByText('1 zone · 4 seats, 2 sold')).toBeVisible();
    await expect(page.getByText('1 of 2 checked in')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    await expect(confirmation(page).getByRole('heading')).toHaveText('Cancel this event?');
    await confirmation(page).getByRole('button', { name: 'No, keep event' }).click();
    await expect(confirmation(page)).toBeHidden();
    expect(api.requests('POST', `event/events/${EVENT_ID}/cancel`)).toHaveLength(0);

    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    await confirmation(page).getByRole('button', { name: 'Yes, cancel event' }).click();
    await expect(page.getByRole('button', { name: 'Re-publish event' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel event', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Re-publish event' }).click();
    await expect(confirmation(page).getByRole('heading')).toHaveText('Re-publish this event?');
    await expect(confirmation(page)).toContainText(
      'Are you sure you want to enable this event and put it back on sale?',
    );
    // Going ahead is the positive choice here, so Yes is green and No is red.
    await expect(confirmation(page).getByRole('button', { name: 'Yes, re-publish' })).toHaveCSS(
      'background-color',
      'rgb(21, 128, 61)',
    );
    await expect(confirmation(page).getByRole('button', { name: 'No' })).toHaveCSS(
      'background-color',
      'rgb(198, 40, 40)',
    );
    await confirmation(page).getByRole('button', { name: 'Yes, re-publish' }).click();
    await expect(page.getByRole('button', { name: 'Cancel event', exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('a failed cancellation is reported and the event stays as it was', async ({ page, api }) => {
    stubEvent(api, { status: 'PUBLISHED' });
    api.on('POST', `event/events/${EVENT_ID}/cancel`, { status: 500, json: { error: 'boom' } });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    await confirmation(page).getByRole('button', { name: 'Yes, cancel event' }).click();

    await expect(management(page).getByRole('alert')).toContainText(
      'Unable to cancel this event. Please try again.',
    );
    await expect(page.getByRole('button', { name: 'Cancel event' })).toBeVisible();
  });

  test('cancelling once customers have bought tickets warns about them first', async ({
    page,
    api,
  }) => {
    const state = stubEvent(api, { status: 'PUBLISHED' });
    api
      .on('GET', `event/events/${EVENT_ID}/cancellation-impact`, {
        json: { eventId: EVENT_ID, customers: 2, ticketsSold: 3, requiresConfirmation: true },
      })
      .on('POST', `event/events/${EVENT_ID}/cancel`, () => {
        state.event = { ...state.event, status: 'CANCELLED' };
        return { status: 204 };
      });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    const dialog = confirmation(page);
    await expect(dialog.getByRole('heading')).toHaveText('Customers have bought tickets');
    await expect(dialog).toContainText(
      '2 customers have already purchased 3 tickets for this event.',
    );
    await expect(dialog).toContainText('void their tickets and email them');
    // The safe choice is focused, so pressing Escape or Enter never cancels by accident.
    await expect(dialog.getByRole('button', { name: 'No, keep event' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(api.requests('POST', `event/events/${EVENT_ID}/cancel`)).toHaveLength(0);

    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    await dialog.getByRole('button', { name: 'Yes, cancel event' }).click();
    await expect(page.getByRole('button', { name: 'Re-publish event' })).toBeVisible();
    const cancels = api.requests('POST', `event/events/${EVENT_ID}/cancel`);
    expect(cancels.map((request) => request.postDataJSON())).toEqual([{ confirm: true }]);
  });

  test('completed: everything is read-only', async ({ page, api }) => {
    stubEvent(api, {
      status: 'PUBLISHED',
      starts_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByText('This event has completed.')).toBeVisible();
    await expect(page.getByLabel('Title')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel event' })).toBeDisabled();
    await expect(page.getByLabel('Email')).toBeDisabled();
    await expect(
      row(page, helperMember.user_email).getByRole('button', { name: 'Remove' }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: /Promote|Demote/ })).toHaveCount(0);
  });
});

test.describe('the team roster', () => {
  test('the owner can promote, demote and remove others, but has no actions on their own row', async ({
    page,
    api,
  }) => {
    const state = stubEvent(api);
    api
      .on('PATCH', /event\/events\/7\/team-members\/.+/, (request) => {
        const sub = decodeURIComponent(request.url().split('/team-members/')[1]);
        const { role } = request.postDataJSON() as { role: Member['role'] };
        state.members = state.members.map((m) => (m.user_sub === sub ? { ...m, role } : m));
        return { status: 204 };
      })
      .on('DELETE', /event\/events\/7\/team-members\/.+/, (request) => {
        const sub = decodeURIComponent(request.url().split('/team-members/')[1]);
        state.members = state.members.filter((m) => m.user_sub !== sub);
        return { status: 204 };
      });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    const own = row(page, owner.user_email);
    await expect(own).toContainText('Olive Organiser');
    await expect(own).toContainText('Organizer · accepted');
    await expect(own.getByRole('button')).toHaveCount(0);
    await expect(
      page.getByText('You own this event and can remove other organizers.'),
    ).toBeVisible();

    answerNext(page, true);
    await row(page, helperMember.user_email)
      .getByRole('button', { name: 'Promote to organizer' })
      .click();
    await expect(row(page, helperMember.user_email)).toContainText('Organizer · accepted');
    const [promote] = api.requests('PATCH', /team-members/);
    expect(promote.postDataJSON()).toEqual({ role: 'ORGANISER' });
    expect(decodeURIComponent(promote.url())).toContain(`/team-members/${HELPER_SUB}`);

    answerNext(page, true);
    await row(page, helperMember.user_email)
      .getByRole('button', { name: 'Demote to helper' })
      .click();
    await expect(row(page, helperMember.user_email)).toContainText('Helper · accepted');

    answerNext(page, false);
    await row(page, coOrganiser.user_email).getByRole('button', { name: 'Remove' }).click();
    await expect(row(page, coOrganiser.user_email)).toBeVisible();
    answerNext(page, true);
    await row(page, coOrganiser.user_email).getByRole('button', { name: 'Remove' }).click();
    await expect(row(page, coOrganiser.user_email)).toHaveCount(0);

    expect(dialogs).toEqual([
      `Promote ${helperMember.user_email} to Organizer?`,
      `Demote ${helperMember.user_email} to Helper?`,
      `Remove ${coOrganiser.user_email} from this event?`,
      `Remove ${coOrganiser.user_email} from this event?`,
    ]);
  });

  test('an organiser who is not the owner can only remove helpers', async ({ page, api }) => {
    stubEvent(api, { organiser_sub: OTHER_ORGANISER }, [
      { ...owner, user_sub: OTHER_ORGANISER, user_email: 'owner@example.test' },
      { ...owner, membership_id: 9 },
      helperMember,
    ]);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(
      row(page, helperMember.user_email).getByRole('button', { name: 'Remove' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Promote|Demote/ })).toHaveCount(0);
    await expect(
      row(page, 'owner@example.test').getByRole('button', { name: 'Remove' }),
    ).toHaveCount(0);
    await expect(page.getByText('You own this event')).toHaveCount(0);
  });

  test('a refused change is reported', async ({ page, api }) => {
    stubEvent(api);
    api.on('PATCH', /team-members/, { status: 403, json: { error: 'event_owner_required' } });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    answerNext(page, true);
    await row(page, helperMember.user_email)
      .getByRole('button', { name: 'Promote to organizer' })
      .click();

    await expect(management(page).getByRole('alert')).toContainText(
      "Only the event's owner can do that.",
    );
  });

  test('a team with nobody on it says so', async ({ page, api }) => {
    stubEvent(api, {}, []);
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByText('No team members yet.')).toBeVisible();
  });
});

test.describe('who can manage an event', () => {
  test('someone who is not on the team gets no management controls', async ({ page, api }) => {
    await signInAs(page, customer);
    stubEvent(api);
    api.on('GET', `event/events/${EVENT_ID}/team-members`, {
      status: 403,
      json: { error: 'event_organiser_required' },
    });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByRole('heading', { name: 'E2E Summer Concert' })).toBeVisible();
    await expect(management(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel event' })).toHaveCount(0);
  });

  test('an event that does not exist says so', async ({ page, api }) => {
    api.on('GET', `event/events/${EVENT_ID}`, { status: 404, json: { error: 'event_not_found' } });
    await page.goto(`/organiser/events/${EVENT_ID}`);

    await expect(page.getByRole('heading', { name: 'Event not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to events' })).toBeVisible();
  });
});
