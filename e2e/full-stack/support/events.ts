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

export interface NewEvent {
  readonly title: string;
  readonly tier: Tier;
  readonly totalSeats: number;
  readonly availableBuyers: number;
}

/** Creates a draft event through the organiser's form and returns its id. */
export async function createEvent(page: Page, event: NewEvent): Promise<number> {
  await page.goto('/organiser/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Title').fill(event.title);
  await page.getByLabel('Description').fill('Created by the full-stack e2e suite');
  await page.getByLabel('Venue').fill('E2E Test Hall');
  await page.getByLabel('Starts at').fill(startsAt(7));
  await page.getByLabel('Total seats').fill(String(event.totalSeats));
  await page.getByLabel('Available buyers').fill(String(event.availableBuyers));
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

/** Publishes a draft from the organiser's event list, accepting the confirmation prompt. */
export async function publishEvent(page: Page, title: string): Promise<void> {
  await page.goto('/organiser/events');
  const card = page.getByRole('listitem').filter({ hasText: title });
  // Publishing asks for confirmation; Playwright dismisses dialogs unless one is accepted.
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('publish this event');
    await dialog.accept();
  });
  await card.getByRole('button', { name: 'Publish' }).click();
  await expect(card).toContainText('On sale');
}
