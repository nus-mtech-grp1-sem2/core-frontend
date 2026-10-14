import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { create } from 'qrcode';
import { of } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';

import {
  Checkin,
  checkInPrompt,
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

  it('confirms in the app dialog, naming the holder, with Yes as the default answer', () => {
    const ticket = {
      ticket_id: 501,
      customer_name: 'Casey Customer',
      customer_email: 'casey@example.test',
      seat_id: null,
      status: 'ISSUED',
    };

    expect(checkInPrompt(ticket)).toEqual({
      title: 'Check in this ticket?',
      message: ['Casey Customer (casey@example.test)', 'General admission'],
      confirmLabel: 'Yes, check in',
      cancelLabel: 'No',
      tone: 'positive',
      defaultChoice: 'confirm',
    });
    expect(checkInPrompt({ ...ticket, customer_name: '', seat_id: 12 }).message).toEqual([
      'casey@example.test',
      'Reserved seat',
    ]);
  });
});

describe('switching the assigned event', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('clears the manual lookup and its results', async () => {
    const api = {
      get: vi.fn((_service: string, path: string) => {
        if (path === '/helper/shifts') {
          return of({
            events: [
              { event_id: 7, title: 'First event', starts_at: '2099-01-01T00:00:00Z' },
              { event_id: 8, title: 'Second event', starts_at: '2099-01-02T00:00:00Z' },
            ],
          });
        }
        if (path.startsWith('/tickets/search')) {
          return of({
            tickets: [
              {
                ticket_id: 501,
                customer_name: 'Casey Customer',
                customer_email: 'casey@example.test',
                seat_id: null,
                status: 'ISSUED',
              },
            ],
          });
        }
        return of({ checkedIn: 0, issued: 0 });
      }),
      post: vi.fn(() => of({ sessionToken: 'scanner-session' })),
    };
    await TestBed.configureTestingModule({
      imports: [Checkin],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '7' } } } },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: () => ({ email: 'helper@example.com' }) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Checkin);
    const host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const query = host.querySelector<HTMLInputElement>('#query')!;
    const checkInButtons = () =>
      Array.from(host.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Check in',
      );

    query.value = 'casey';
    query.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();
    expect(checkInButtons()).toHaveLength(1);
    expect(host.querySelector('.search-status')?.textContent?.trim()).toBe('1 result');

    const select = host.querySelector<HTMLSelectElement>('#event')!;
    select.value = '8';
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    fixture.detectChanges();

    expect(query.value).toBe('');
    expect(checkInButtons()).toHaveLength(0);
    expect(host.querySelector('.search-status')?.textContent?.trim()).toBe('');
    fixture.destroy();
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
  it('shows the image-load guidance when decodeImage cannot open a fake PNG', async () => {
    const nativeUrl = URL;
    const api = {
      get: vi.fn((_service: string, path: string) =>
        path === '/helper/shifts'
          ? of({
              events: [{ event_id: 7, title: 'Test event', starts_at: '2099-01-01T00:00:00Z' }],
            })
          : of({ checkedIn: 0, issued: 0 }),
      ),
      post: vi.fn(() => of({ sessionToken: 'scanner-session' })),
    };
    const failingImage = class {
      decoding = '';
      naturalWidth = 0;
      width = 0;
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      }
    };
    const testUrl = Object.assign(class extends nativeUrl {}, {
      createObjectURL: vi.fn(() => 'blob:test-image'),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal('URL', testUrl);
    vi.stubGlobal('Image', failingImage);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));

    await TestBed.configureTestingModule({
      imports: [Checkin],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '7' } } } },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: () => ({ email: 'helper@example.com' }) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(Checkin);
    try {
      fixture.detectChanges();
      await fixture.whenStable();
      const component = fixture.componentInstance as unknown as {
        decodeImage(file: File): Promise<void>;
      };
      await component.decodeImage(new File(['not an image'], 'ticket.png', { type: 'image/png' }));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
        'That file could not be opened as an image. Save the ticket QR as a PNG or JPG and upload that.',
      );
      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).not.toContain(
        'browser console',
      );
    } finally {
      fixture.destroy();
      vi.unstubAllGlobals();
      TestBed.resetTestingModule();
    }
  });

  it('tells the helper the file was not a usable image when decoding never started', () => {
    expect(uploadErrorMessage(new Error('qr_image_empty'))).toBe(
      'That file could not be opened as an image. Save the ticket QR as a PNG or JPG and upload that.',
    );
    expect(uploadErrorMessage(new Error('qr_image_load_failed'))).toBe(
      'That file could not be opened as an image. Save the ticket QR as a PNG or JPG and upload that.',
    );
  });

  it('keeps the crop advice for an image that decoded but held no QR code', () => {
    expect(uploadErrorMessage(new Error('qr_not_found'))).toBe(
      'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.',
    );
    expect(uploadErrorMessage(undefined)).toBe(
      'No readable QR code was found. Upload the original image or a crop with a clear white border around the whole QR code.',
    );
  });

  it('uses the browser-blocked decoding guidance for a canvas failure', () => {
    expect(uploadErrorMessage(new Error('qr_canvas_unavailable'))).toBe(
      'This browser blocked image decoding. Use the camera or enter the QR token manually.',
    );
  });
});
