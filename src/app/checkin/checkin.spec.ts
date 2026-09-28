import { create } from 'qrcode';

import {
  currentAndFutureEvents,
  decodeQrPixels,
  canCheckIn,
  isSearchableQuery,
  outcomeDescription,
  outcomeIcon,
  qrCanvasPlan,
  uploadErrorMessage,
} from './checkin';

describe('event helper outcomes', () => {
  it('maps every server outcome to explicit helper-facing text', () => {
    expect(outcomeDescription('VALID')).toContain('Valid ticket');
    expect(outcomeDescription('ALREADY_USED')).toContain('Already used');
    expect(outcomeDescription('INVALID')).toContain('Invalid ticket');
    expect(outcomeDescription('WRONG_EVENT')).toContain('Wrong event');
  });

  it('keeps the outcome descriptions distinct for assistive feedback', () => {
    expect(outcomeDescription('VALID')).not.toBe(outcomeDescription('ALREADY_USED'));
    expect(outcomeDescription('INVALID')).not.toBe(outcomeDescription('WRONG_EVENT'));
  });

  it('provides non-color indicators for every outcome', () => {
    const outcomes = ['VALID', 'ALREADY_USED', 'INVALID', 'WRONG_EVENT'] as const;
    expect(new Set(outcomes.map((outcome) => outcomeIcon(outcome))).size).toBe(4);
  });
});

describe('manual lookup check-in button', () => {
  it('is offered only for a ticket that is still issued', () => {
    expect(canCheckIn('ISSUED')).toBe(true);
    expect(canCheckIn('CHECKED_IN')).toBe(false);
    expect(canCheckIn('VOID')).toBe(false);
  });
});

describe('manual lookup query', () => {
  it('searches a short order ID straight away', () => {
    expect(isSearchableQuery('7')).toBe(true);
    expect(isSearchableQuery('82')).toBe(true);
  });

  it('waits for three characters of name or email, as the ticket service requires', () => {
    expect(isSearchableQuery('')).toBe(false);
    expect(isSearchableQuery('Al')).toBe(false);
    expect(isSearchableQuery('8a')).toBe(false);
    expect(isSearchableQuery('Ada')).toBe(true);
  });
});

describe('assigned events for check-in', () => {
  const now = new Date(2026, 8, 21, 15, 30);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).toISOString();
  const ids = (events: readonly { readonly event_id: number }[]) =>
    events.map((event) => event.event_id);

  it('drops events from earlier days and keeps today and later', () => {
    const events = [
      { event_id: 1, title: 'Last week', starts_at: at(14, 19) },
      { event_id: 2, title: 'Last night', starts_at: at(20, 23, 59) },
      { event_id: 3, title: 'Tonight', starts_at: at(21, 19, 30) },
      { event_id: 4, title: 'Tomorrow', starts_at: at(22, 19) },
      { event_id: 5, title: 'Next month', starts_at: new Date(2026, 9, 30, 19).toISOString() },
    ];

    expect(ids(currentAndFutureEvents(events, now))).toEqual([3, 4, 5]);
  });

  it('keeps an event that already started earlier today, since the door is still open', () => {
    const events = [
      { event_id: 1, title: 'Started at midnight', starts_at: at(21, 0) },
      { event_id: 2, title: 'Started this morning', starts_at: at(21, 9) },
    ];

    expect(ids(currentAndFutureEvents(events, now))).toEqual([1, 2]);
  });

  it('reads the alternate event_start_datetime field the service may return', () => {
    const events = [
      { event_id: 1, title: 'Past', event_start_datetime: at(19, 19) },
      { event_id: 2, title: 'Upcoming', event_start_datetime: at(23, 19) },
    ];

    expect(ids(currentAndFutureEvents(events, now))).toEqual([2]);
  });

  it('keeps an event whose start time is missing or unreadable rather than hiding it', () => {
    const events = [
      { event_id: 1, title: 'No date' },
      { event_id: 2, title: 'Bad date', starts_at: 'not a date' },
    ];

    expect(ids(currentAndFutureEvents(events, now))).toEqual([1, 2]);
  });

  it('returns an empty list when every assigned event is in the past', () => {
    const events = [{ event_id: 1, title: 'Old', starts_at: at(1, 19) }];

    expect(currentAndFutureEvents(events, now)).toEqual([]);
  });
});

describe('uploaded QR image preparation', () => {
  it('decodes a dense ticket QR at two pixels per module with only a one-module border', () => {
    const token = '8d70e932-51f7-4e17-8bb1-1578ea497672:ticket:0000000000000001';
    const qr = create(token, { errorCorrectionLevel: 'M' });
    const margin = 1;
    const scale = 2;
    const side = (qr.modules.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4);

    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const moduleRow = Math.floor(y / scale) - margin;
        const moduleColumn = Math.floor(x / scale) - margin;
        const isDark =
          moduleRow >= 0 &&
          moduleColumn >= 0 &&
          moduleRow < qr.modules.size &&
          moduleColumn < qr.modules.size &&
          qr.modules.get(moduleRow, moduleColumn) === 1;
        const offset = (y * side + x) * 4;
        const value = isDark ? 0 : 255;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    }

    expect(decodeQrPixels(pixels, side, side)).toBe(token);
  });

  it('upscales small QR crops without smoothing and adds a white quiet zone', () => {
    expect(qrCanvasPlan(80, 80)).toEqual({
      scale: 8,
      padding: 51,
      width: 742,
      height: 742,
    });
  });

  it('does not enlarge already high-resolution screenshots', () => {
    expect(qrCanvasPlan(1600, 900)).toEqual({
      scale: 1,
      padding: 72,
      width: 1744,
      height: 1044,
    });
  });
});

describe('uploaded QR failures', () => {
  it('tells the helper the file was not a usable image when decoding never started', () => {
    expect(uploadErrorMessage(new Error('qr_image_empty'))).toContain('could not be opened');
    expect(uploadErrorMessage(new Error('qr_image_load_failed'))).toContain('could not be opened');
  });

  it('keeps the crop advice for an image that decoded but held no QR code', () => {
    expect(uploadErrorMessage(new Error('qr_not_found'))).toContain('No readable QR code');
    expect(uploadErrorMessage(undefined)).toContain('No readable QR code');
  });
});
