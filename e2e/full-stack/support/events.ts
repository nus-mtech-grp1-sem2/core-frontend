import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

import { accessToken, useSession } from './auth';
import type { Role } from './users';

export type Tier = 'TIER1_GA' | 'TIER2_SEATED';

/** A page in a fresh browser context that is signed in as `role`. Close `page.context()` when done. */
export async function signedInPage(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext();
  await useSession(context, role);
  return context.newPage();
}

/** `YYYY-MM-DDTHH:mm` in local time, `days` from now, as a datetime-local input expects. */
export function startsAt(days: number): string {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Seats come later, from `configureInventory`; available buyers from `setAvailableBuyers`. */
export interface NewEvent {
  readonly title: string;
  readonly tier: Tier;
}

/** Creates a draft event through the organiser's form and returns its id. */
export async function createEvent(page: Page, event: NewEvent): Promise<number> {
  await page.goto('/organiser/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Title').fill(event.title);
  await page.getByLabel('Description').fill('Created by the full-stack e2e suite');
  await page.getByLabel('Venue').fill('E2E Test Hall');
  await page.getByLabel('Starts at').fill(startsAt(7));
  await page.getByLabel('Ticketing').selectOption(event.tier);

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/event/events') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create event' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { eventId } = (await response.json()) as { eventId: number };
  expect(eventId).toBeGreaterThan(0);
  return eventId;
}

/**
 * Gives the event one zone of `cols` seats in a single row. The seat-map editor is a drag-to-draw
 * canvas, so this makes the same call it makes (the response is 204 No Content).
 */
export async function configureInventory(
  request: APIRequestContext,
  eventId: number,
  zone: { readonly name: string; readonly price: number; readonly cols: number },
): Promise<void> {
  const response = await request.put(`/api/inventory/events/${eventId}/inventory`, {
    headers: { Authorization: `Bearer ${accessToken('organiser')}` },
    data: {
      zones: [
        {
          inventoryItemId: null,
          name: zone.name,
          price: zone.price,
          color: '#2563eb',
          gridRow: 0,
          gridCol: 0,
          gridRowSpan: 1,
          gridColSpan: zone.cols,
        },
      ],
      gridRows: 1,
      gridCols: zone.cols,
    },
  });
  expect(response.ok(), `inventory PUT -> ${response.status()} ${await response.text()}`).toBe(
    true,
  );
}

/**
 * Sets how many waiting-room customers are admitted together. It must not exceed the event's total
 * seats, so call it after `configureInventory`. Saves the draft the way its edit form does.
 */
export async function setAvailableBuyers(
  request: APIRequestContext,
  eventId: number,
  availableBuyers: number,
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken('organiser')}` };
  const loaded = await request.get(`/api/event/events/${eventId}`, { headers });
  expect(loaded.ok(), `event GET -> ${loaded.status()}`).toBe(true);
  const { event } = (await loaded.json()) as {
    event: { title: string; description: string | null; venue: string; starts_at: string; tier: Tier };
  };
  const response = await request.put(`/api/event/events/${eventId}`, {
    headers,
    data: {
      title: event.title,
      description: event.description ?? '',
      venue: event.venue,
      startsAt: event.starts_at.replace(' ', 'T').slice(0, 16),
      tier: event.tier,
      availableBuyers,
    },
  });
  expect(response.ok(), `event PUT -> ${response.status()} ${await response.text()}`).toBe(true);
}

/** Publishes a draft from the organiser's event list, accepting the confirmation prompt. */
export async function publishEvent(page: Page, title: string): Promise<void> {
  await page.goto('/organiser/events');
  const card = page.getByRole('listitem').filter({ hasText: title });
  // Publishing asks for confirmation in the app's own dialog.
  await card.getByRole('button', { name: 'Publish' }).click();
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText('publish this event');
  await confirmation.getByRole('button', { name: 'Yes, publish' }).click();
  await expect(card).toContainText('On sale');
}
