import { expect, test } from './support/fixtures';
import {
  EVENT_ID,
  OUTCOMES,
  SCANNER_TOKEN,
  TICKET_TOKEN,
  stubDoorApi,
  uploadFile,
} from './support/door';
import { BLANK_PNG, degrade, qrPng } from './support/qr-images';
import { helper, signInAs } from './support/session';

test.beforeEach(async ({ page, api }) => {
  await signInAs(page, helper);
  stubDoorApi(api);
});

async function uploadQr(page: import('@playwright/test').Page, image: Buffer) {
  await uploadFile(page, { name: 'ticket.png', mimeType: 'image/png', buffer: image });
}

test('shows the door workspace for an assigned event', async ({ page }) => {
  await page.goto(`/checkin/${EVENT_ID}`);
  await expect(page.getByRole('status').filter({ hasText: '3 of 10 checked in' })).toBeVisible();
});

for (const { apiOutcome, message } of OUTCOMES) {
  test(`uploaded QR: ${apiOutcome} is reported as "${message}"`, async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: apiOutcome } });
    await page.goto(`/checkin/${EVENT_ID}`);

    await uploadQr(page, await qrPng());

    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();

    const [validate] = api.requests('POST', 'ticket/tickets/validate');
    expect(validate.postDataJSON()).toEqual({ qrToken: TICKET_TOKEN });
    expect(await validate.headerValue('authorization')).toBe(`Bearer ${SCANNER_TOKEN}`);
  });
}

test('an image with no QR code is rejected without calling ticket validation', async ({
  page,
  api,
}) => {
  await page.goto(`/checkin/${EVENT_ID}`);

  await uploadQr(page, BLANK_PNG);

  await expect(page.getByRole('alert')).toContainText(
    'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.',
  );
  expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
});

test('a helper not assigned to the event is told so', async ({ page, api }) => {
  api.on('POST', 'ticket/scanner/sessions', { status: 403, json: { error: 'forbidden' } });
  await page.goto(`/checkin/${EVENT_ID}`);

  await expect(page.getByRole('alert')).toContainText(
    'This event is not assigned to your helper account.',
  );
});

test.describe('QR images of varying quality', () => {
  const NO_QR_GUIDANCE =
    'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.';
  const IMAGE_LOAD_GUIDANCE =
    'That file could not be opened as an image. Save the ticket QR as a PNG or JPG and upload that.';

  test.beforeEach(async ({ page, api }) => {
    api.on('POST', 'ticket/tickets/validate', { json: { outcome: 'SUCCESS' } });
    await page.goto(`/checkin/${EVENT_ID}`);
  });

  const readable = [
    // A shrunken screenshot: modules ~2 px wide with anti-aliased grey edges, which the
    // small-QR recovery in src/app/checkin/qr-small-recovery.ts exists for.
    { name: 'a small crop with a white border', recipe: { width: 64 } },
    { name: 'a low-contrast image (dark grey on light grey)', recipe: { ink: 110, paper: 215 } },
    { name: 'a large image', recipe: { width: 1600 } },
  ];

  for (const { name, recipe } of readable) {
    test(`reads ${name}`, async ({ page, api }) => {
      await uploadQr(page, await degrade(page, await qrPng(), recipe));

      await expect(
        page.getByRole('status').filter({ hasText: 'Valid ticket. Check-in accepted.' }),
      ).toBeVisible();
      const [validate] = api.requests('POST', 'ticket/tickets/validate');
      expect(validate.postDataJSON()).toEqual({ qrToken: TICKET_TOKEN });
    });
  }

  const unreadable = [
    {
      name: 'a QR that is cropped through the middle',
      recipe: { keep: { x: 0, y: 0, w: 0.6, h: 1 } },
    },
    { name: 'an almost invisible QR (near-white on white)', recipe: { ink: 254, paper: 255 } },
  ];

  for (const { name, recipe } of unreadable) {
    test(`rejects ${name} without calling ticket validation`, async ({ page, api }) => {
      await uploadQr(page, await degrade(page, await qrPng(), recipe));

      await expect(page.getByRole('alert')).toContainText(NO_QR_GUIDANCE);
      expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
    });
  }

  test('rejects a file that is not an image without calling ticket validation', async ({
    page,
    api,
  }) => {
    await uploadFile(page, {
      name: 'ticket.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 not an image'),
    });

    await expect(page.getByRole('alert')).toContainText(IMAGE_LOAD_GUIDANCE);
    expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
  });

  test('rejects a file named like an image that is not one', async ({ page, api }) => {
    await uploadFile(page, {
      name: 'ticket.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is plain text, not a PNG'),
    });

    await expect(page.getByRole('alert')).toContainText(IMAGE_LOAD_GUIDANCE);
    expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
  });

  test('refuses an image over 12 MB before reading it', async ({ page, api }) => {
    await uploadFile(page, {
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(12 * 1024 * 1024 + 1),
    });

    await expect(page.getByRole('alert')).toContainText(
      'That image is too large. Upload a QR image smaller than 12 MB.',
    );
    expect(api.requests('POST', 'ticket/tickets/validate')).toHaveLength(0);
  });

  test('a failed read leaves the door ready for the next image', async ({ page }) => {
    await uploadQr(page, BLANK_PNG);
    await expect(page.getByRole('alert')).toContainText(NO_QR_GUIDANCE);

    await uploadQr(page, await qrPng());

    await expect(
      page.getByRole('status').filter({ hasText: 'Valid ticket. Check-in accepted.' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
