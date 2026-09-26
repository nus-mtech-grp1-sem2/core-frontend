import type { Page } from '@playwright/test';

import type { MockApi } from './api';

export const EVENT_ID = 7;
export const SCANNER_TOKEN = 'scanner-session-test-token';
export const TICKET_TOKEN = 'tkt_test_0123456789abcdef';

/** What the door screen tells the helper for each answer of the ticket service. */
export const OUTCOMES = [
  { apiOutcome: 'SUCCESS', message: 'Valid ticket. Check-in accepted.' },
  { apiOutcome: 'DUPLICATE', message: 'Already used. This ticket was checked in earlier.' },
  {
    apiOutcome: 'WRONG_EVENT',
    message: 'Wrong event. This ticket is not assigned to this event.',
  },
  { apiOutcome: 'INVALID', message: 'Invalid ticket. It could not be checked in.' },
] as const;

/** Stubs what the door screen loads for an assigned helper. Sign the helper in first. */
export function stubDoorApi(api: MockApi): void {
  api
    .on('GET', 'event/helper/shifts', {
      json: {
        events: [
          {
            event_id: EVENT_ID,
            title: 'E2E Helper Concert',
            starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          },
        ],
      },
    })
    .on('POST', 'ticket/scanner/sessions', { json: { sessionToken: SCANNER_TOKEN } })
    .on('GET', `ticket/events/${EVENT_ID}/checkin-stats`, { json: { checkedIn: 3, issued: 10 } });
}

/** Chooses `file` in the "Upload QR image" input, as a helper picking a screenshot would. */
export async function uploadFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.getByLabel('Upload QR image').setInputFiles(file);
}
