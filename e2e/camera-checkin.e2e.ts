import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';
import { EVENT_ID, OUTCOMES, SCANNER_TOKEN, TICKET_TOKEN, stubDoorApi } from './support/door';
import { helper, signInAs } from './support/session';

// Runs in the `mocked-camera` project: Chromium is launched with a fake camera that films the
// QR code of TICKET_TOKEN (see playwright.config.ts). The ticket service is stubbed, so the
// answer to each scan is whatever the test says; what is under test is the browser side.

test.beforeEach(async ({ page, api }) => {
  await signInAs(page, helper);
  stubDoorApi(api);
});

const openCamera = (page: Page) => page.getByRole('button', { name: 'Open camera' }).click();

for (const { apiOutcome, message } of OUTCOMES) {
  test(`camera scan: ${apiOutcome} is reported as "${message}"`, async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: apiOutcome } });
    await page.goto(`/checkin/${EVENT_ID}`);

    await openCamera(page);

    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
    const [validate] = api.requests('POST', 'ticket/tickets/validate');
    expect(validate.postDataJSON()).toEqual({ qrToken: TICKET_TOKEN });
    expect(await validate.headerValue('authorization')).toBe(`Bearer ${SCANNER_TOKEN}`);
    // One scan is one ticket: the camera stops instead of checking the same code in again.
    await expect(page.getByRole('button', { name: 'Open camera' })).toBeVisible();
    expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(1);
  });
}

test.describe('with a camera that sees no ticket', () => {
  test.beforeEach(async ({ page }) => {
    // Replace the fake device with a blank video, so nothing is scanned and the test decides
    // when the camera stops. Every track handed out is remembered to check it is released.
    await page.addInitScript(() => {
      const w = window as unknown as { __tracks: MediaStreamTrack[] };
      w.__tracks = [];
      navigator.mediaDevices.getUserMedia = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        const stream = canvas.captureStream(5);
        w.__tracks.push(...stream.getTracks());
        return Promise.resolve(stream);
      };
    });
  });

  const trackStates = (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState),
    );

  test('shows the preview while scanning; Stop camera hides it and releases the camera', async ({
    page,
    api,
  }) => {
    await page.goto(`/checkin/${EVENT_ID}`);
    await expect(page.getByLabel('Camera preview')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Stop camera' })).toHaveCount(0);

    await openCamera(page);
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    expect(await trackStates(page)).toEqual(['live']);

    await page.getByRole('button', { name: 'Stop camera' }).click();

    await expect(page.getByLabel('Camera preview')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open camera' })).toBeVisible();
    expect(await trackStates(page)).toEqual(['ended']);
    expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
  });

  test('leaving the door screen releases the camera', async ({ page, api }) => {
    // Only a shift that starts today offers the "Open door check-in" link.
    api.on('GET', 'event/helper/shifts', {
      json: {
        events: [
          {
            event_id: EVENT_ID,
            title: 'E2E Helper Concert',
            venue: 'E2E Hall',
            total_seats: 10,
            starts_at: new Date().toISOString(),
          },
        ],
      },
    });
    await page.goto('/helper');
    await page.getByRole('link', { name: 'Open door check-in' }).first().click();
    await openCamera(page);
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    expect(await trackStates(page)).toEqual(['live']);

    await page.goBack();

    await expect(page).toHaveURL(/\/helper$/);
    await expect.poll(() => trackStates(page)).toEqual(['ended']);
  });
});

test.describe('sound', () => {
  test.beforeEach(async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: 'SUCCESS' } });
    // Count the audio contexts the page creates: each scan result beeps through one.
    await page.addInitScript(() => {
      const w = window as unknown as { __beeps: number; AudioContext: typeof AudioContext };
      w.__beeps = 0;
      const Original = w.AudioContext;
      w.AudioContext = class extends Original {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          w.__beeps += 1;
        }
      };
    });
    await page.goto(`/checkin/${EVENT_ID}`);
  });

  const beeps = (page: Page) =>
    page.evaluate(() => (window as unknown as { __beeps: number }).__beeps);

  test('beeps on a scan by default', async ({ page }) => {
    await expect(page.getByRole('status').filter({ hasText: 'Sound on' })).toBeVisible();

    await openCamera(page);
    await expect(page.getByRole('status').filter({ hasText: 'Valid ticket' })).toBeVisible();

    expect(await beeps(page)).toBe(1);
  });

  test('the mute toggle silences the beep and can be reversed', async ({ page }) => {
    await page.getByRole('button', { name: 'Mute sounds' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sound muted' })).toBeVisible();

    await openCamera(page);
    await expect(page.getByRole('status').filter({ hasText: 'Valid ticket' })).toBeVisible();
    expect(await beeps(page)).toBe(0);

    await page.getByRole('button', { name: 'Unmute sounds' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sound on' })).toBeVisible();
  });
});

test.describe('when the camera cannot be used', () => {
  /** Makes `getUserMedia` fail the way a browser does: with a DOMException of this name. */
  async function failCameraWith(page: Page, name: string) {
    await page.addInitScript((errorName) => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('blocked by the test', errorName));
    }, name);
  }

  const failures = [
    {
      error: 'NotAllowedError',
      message:
        'Camera permission was denied. Allow camera access in your browser settings and try again.',
    },
    { error: 'NotFoundError', message: 'No usable camera was found on this device.' },
    {
      error: 'NotReadableError',
      message:
        'The camera could not be started. Close other camera apps or enter the QR token manually.',
    },
  ];

  for (const { error, message } of failures) {
    test(`${error} tells the helper what to do and offers a retry`, async ({ page, api }) => {
      await failCameraWith(page, error);
      await page.goto(`/checkin/${EVENT_ID}`);

      await openCamera(page);

      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByLabel('Camera preview')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Try camera again' })).toBeVisible();
      expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
    });
  }

  test('a browser without camera support says so', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined });
    });
    await page.goto(`/checkin/${EVENT_ID}`);

    await openCamera(page);

    await expect(page.getByRole('alert')).toContainText(
      'Camera scanning is not supported by this browser.',
    );
  });

  test('Try camera again recovers once the camera is available', async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: 'SUCCESS' } });
    await page.addInitScript(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let failures = 1;
      navigator.mediaDevices.getUserMedia = (constraints) =>
        failures-- > 0
          ? Promise.reject(new DOMException('first attempt fails', 'NotReadableError'))
          : real(constraints);
    });
    await page.goto(`/checkin/${EVENT_ID}`);

    await openCamera(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Try camera again' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Valid ticket' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
