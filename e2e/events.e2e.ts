import { expect, test } from './support/fixtures';
import { expectAccessible } from './support/a11y';
import { managedEvent } from './support/data';

test('a signed-out visitor can browse published events', async ({ page, api }) => {
  api
    .on('GET', 'event/events', { json: { events: [managedEvent()] } })
    .on('GET', 'event/events/7', { json: { event: managedEvent() } });

  await page.goto('/events');

  const card = page.getByRole('listitem').filter({ hasText: 'E2E Summer Concert' });
  await expect(card).toContainText('60 out of 100 seats remaining');
  await expectAccessible(page);
});

test('reports unavailable events instead of an empty list', async ({ page, api }) => {
  api.on('GET', 'event/events', { status: 500, json: { error: 'boom' } });

  await page.goto('/events');

  await expect(page.getByRole('alert')).toContainText('Events are unavailable right now.');
});
