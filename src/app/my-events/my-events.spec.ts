import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, vi } from 'vitest';

import { ApiService } from '../core/api';
import { MyEvents } from './my-events';

vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,test') }));

describe('MyEvents purchase dates', () => {
  async function render(
    options: {
      issued?: boolean;
      paidAt?: string | null;
      status?: string;
      missingOrder?: boolean;
    } = {},
  ) {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets')
        return of({
          tickets: options.issued
            ? [
                {
                  ticket_id: 1,
                  order_id: 42,
                  event_id: 172,
                  event_title: 'Test concert',
                  venue: 'Test Hall',
                  starts_at: '2099-01-01T20:00:00',
                  seat_label: 'A1',
                  qr_token: 'dummy',
                  status: 'ISSUED',
                },
              ]
            : [],
        });
      if (path === '/customers/me/orders')
        return of({
          orders: options.missingOrder
            ? []
            : [
                {
                  order_id: 42,
                  event_id: 172,
                  status: options.status ?? 'PAID',
                  event_title: 'Test concert',
                  venue: 'Test Hall',
                  starts_at: '2099-01-01T20:00:00',
                  ticket_count: 1,
                  total_amount_cents: 2000,
                  currency: 'SGD',
                  paid_at: options.paidAt === undefined ? '2026-09-21T12:30:00' : options.paidAt,
                },
                {
                  order_id: 99,
                  event_id: 172,
                  status: 'PAID',
                  event_title: 'Another booking',
                  venue: 'Test Hall',
                  starts_at: '2099-01-01T20:00:00',
                  ticket_count: 1,
                  total_amount_cents: 2000,
                  currency: 'SGD',
                  paid_at: '2026-08-01T12:30:00',
                },
              ],
        });
      if (path === '/helper/shifts') return of({ events: [] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    await TestBed.configureTestingModule({
      imports: [MyEvents],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: ApiService, useValue: { get } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MyEvents);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the matching order payment date, not the event date or another booking date', async () => {
    const host = await render({ issued: true });
    const card = host.querySelector('.ticket-list .ticket-card');
    expect(card?.textContent).toContain('Bought on');
    expect(card?.textContent).toContain('Event Time: Thu 1 Jan 2099, 8:00 PM');
    expect(card?.textContent).toContain('21 Sep 2026, 12:30 PM');
    expect(card?.textContent).not.toContain('1 Aug 2026');
  });

  it('shows the date while a paid order is awaiting ticket issuance', async () => {
    const host = await render();
    const card = host.querySelector('[aria-label="Paid orders awaiting tickets"] .ticket-card');
    expect(card?.textContent).toContain('Bought on');
    expect(card?.textContent).toContain('Start time: Thu 1 Jan 2099, 8:00 PM');
    expect(card?.textContent).toContain('21 Sep 2026, 12:30 PM');
  });

  it.each([{ paidAt: null }, { missingOrder: true }])(
    'does not invent a purchase date when unavailable: %j',
    async (options) => {
      const host = await render({ issued: true, ...options });
      expect(host.querySelector('.ticket-list .ticket-card')?.textContent).toContain('Unavailable');
    },
  );

  it('does not label an unpaid reservation as bought', async () => {
    const host = await render({ status: 'PENDING', paidAt: null });
    expect(host.querySelector('[aria-label="Orders awaiting payment"]')?.textContent).not.toContain(
      'Bought on',
    );
  });
});

describe('MyEvents unpaid orders', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  async function renderPending(paymentState: 'none' | 'processing' | 'stale' = 'none') {
    if (paymentState !== 'none') {
      sessionStorage.setItem(
        'onestage.acceptedPayment.42',
        String(Date.now() - (paymentState === 'stale' ? 10 * 60_000 : 0)),
      );
    }
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets') return of({ tickets: [] });
      if (path === '/helper/shifts') return of({ events: [] });
      if (path === '/customers/me/orders')
        return of({
          orders: [
            {
              order_id: 42,
              event_id: 172,
              status: 'PENDING',
              event_title: 'Test concert',
              ticket_count: 2,
              total_amount_cents: 4000,
              currency: 'SGD',
              created_at: new Date(Date.now() - 1_000).toISOString(),
              reservation_expires_at: new Date(Date.now() + 180_000).toISOString(),
            },
          ],
        });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const post = vi.fn(() => of(undefined));
    await TestBed.configureTestingModule({
      imports: [MyEvents],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: ApiService, useValue: { get, post } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MyEvents);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, post };
  }

  it('offers payment and cancellation controls when checkout was left before payment', async () => {
    const { fixture, host, post } = await renderPending();
    expect(host.querySelector('a[href="/checkout/42"]')?.textContent).toContain(
      'Continue to payment',
    );
    expect(host.textContent).toContain('Payment pending');
    expect(host.textContent).toMatch(/Reservation expires in\s+3:00/);
    const cancel = host.querySelector<HTMLButtonElement>('.cancel-button');
    expect(cancel?.textContent).toContain('Cancel reservation');
    cancel?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(post).toHaveBeenCalledWith('order', '/orders/42/cancel', {});
    expect(host.querySelector('[aria-label="Orders awaiting payment"]')).toBeNull();
  });

  it('ignores a processing marker created by the old checkout implementation', async () => {
    sessionStorage.setItem('onestage.mockPayment.42', String(Date.now()));
    const { host } = await renderPending();

    expect(host.querySelector('[aria-label="Orders awaiting payment"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Orders processing payment"]')).toBeNull();
    expect(sessionStorage.getItem('onestage.mockPayment.42')).toBeNull();
  });

  it('keeps a submitted order visible as payment processing without offering cancellation', async () => {
    const { host, post } = await renderPending('processing');

    const processing = host.querySelector('[aria-label="Orders processing payment"]');
    expect(processing?.textContent).toContain('Payment is processing');
    expect(processing?.textContent).toContain('can no longer be cancelled');
    expect(host.querySelector('[aria-label="Orders awaiting payment"]')).toBeNull();
    expect(host.querySelector('.cancel-button')).toBeNull();
    expect(host.textContent).not.toContain('No tickets yet');
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores a stale processing marker so a new reservation is not hidden', async () => {
    const { host } = await renderPending('stale');

    expect(host.querySelector('[aria-label="Orders awaiting payment"]')).not.toBeNull();
    expect(host.querySelector('.cancel-button')).not.toBeNull();
    expect(host.querySelector('[aria-label="Orders processing payment"]')).toBeNull();
    expect(sessionStorage.getItem('onestage.acceptedPayment.42')).toBeNull();
  });
});

describe('MyEvents', () => {
  it('excludes tickets and orders for events where the account is on the event team', async () => {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets') {
        return of({
          tickets: [
            {
              ticket_id: 1,
              order_id: 10,
              event_id: 172,
              event_title: 'Team event',
              venue: 'Test Hall',
              starts_at: '2026-09-20 20:00:00',
              seat_label: 'A1',
              qr_token: 'team-event-ticket',
              status: 'ISSUED',
            },
          ],
        });
      }
      if (path === '/customers/me/orders') {
        return of({
          orders: [
            {
              order_id: 11,
              event_id: 172,
              status: 'PAID',
              total_amount_cents: 2_000,
              currency: 'SGD',
              paid_at: '2026-09-19 10:00:00',
              event_title: 'Team event',
              venue: 'Test Hall',
              starts_at: '2026-09-20 20:00:00',
              ticket_count: 1,
            },
          ],
        });
      }
      if (path === '/helper/shifts') return of({ events: [{ event_id: 172 }] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [MyEvents],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: ApiService, useValue: { get } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MyEvents);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Team event');
    expect(text).toContain('No tickets yet');
    expect(get).toHaveBeenCalledWith('event', '/helper/shifts');
  });
});

describe('MyEvents confirmation email note', () => {
  type Answer = 'SENT' | 'FAILED' | 'PENDING' | HttpErrorResponse;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  /** Answers the confirmation endpoint with each answer in turn, repeating the last. */
  async function render(orderId: string | null, answers: readonly Answer[] = ['SENT']) {
    const remaining = [...answers];
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets') return of({ tickets: [] });
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/helper/shifts') return of({ events: [] });
      if (path.endsWith('/confirmation')) {
        const next = remaining.length > 1 ? remaining.shift()! : remaining[0]!;
        return typeof next === 'string'
          ? of({ orderId: Number(orderId), status: next })
          : throwError(() => next);
      }
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MyEvents],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(orderId === null ? {} : { orderId }),
            },
          },
        },
        { provide: ApiService, useValue: { get } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MyEvents);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const advance = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    };
    const asked = () =>
      get.mock.calls.filter(([, path]) => String(path).endsWith('/confirmation')).length;
    const toast = () => host.querySelector('.toast')?.textContent?.trim() ?? null;
    return { fixture, host, get, advance, asked, toast };
  }

  it("asks the ticket service whether the order's emails have gone out", async () => {
    const { get, advance } = await render('42');

    await advance(0);

    expect(get).toHaveBeenCalledWith('ticket', '/customers/me/orders/42/confirmation');
  });

  it('says "Confirmation email sent" once the emails are out, then removes it after 3 seconds', async () => {
    const { advance, toast } = await render('42', ['SENT']);

    await advance(0);
    expect(toast()).toBe('Confirmation email sent');

    await advance(2_999);
    expect(toast()).toBe('Confirmation email sent');

    await advance(1);
    expect(toast()).toBeNull();
  });

  it('waits, without saying anything, while the emails are still going out', async () => {
    const { advance, asked, toast } = await render('42', ['PENDING', 'PENDING', 'SENT']);

    await advance(0);
    await advance(2_000);
    expect(toast()).toBeNull();
    expect(asked()).toBe(2);

    await advance(2_000);
    expect(toast()).toBe('Confirmation email sent');
    expect(asked()).toBe(3);
  });

  it('stops asking once the emails are confirmed', async () => {
    const { advance, asked } = await render('42', ['PENDING', 'SENT']);

    await advance(60_000);

    expect(asked()).toBe(2);
  });

  it('keeps trying through a temporary failure', async () => {
    const { advance, toast } = await render('42', [
      new HttpErrorResponse({ status: 502, error: { error: 'confirmation_status_failed' } }),
      'SENT',
    ]);

    await advance(0);
    expect(toast()).toBeNull();

    await advance(2_000);
    expect(toast()).toBe('Confirmation email sent');
  });

  it('says nothing, and stops asking, when the emails failed to send', async () => {
    const { advance, asked, toast } = await render('42', ['FAILED']);

    await advance(60_000);

    expect(toast()).toBeNull();
    expect(asked()).toBe(1);
  });

  it("stops asking when the order is not the customer's", async () => {
    const { advance, asked, toast } = await render('42', [
      new HttpErrorResponse({ status: 404, error: { error: 'order_not_found' } }),
    ]);

    await advance(60_000);

    expect(toast()).toBeNull();
    expect(asked()).toBe(1);
  });

  it('gives up quietly after 20 attempts if the emails never go out', async () => {
    const { advance, asked, toast } = await render('42', ['PENDING']);

    await advance(120_000);

    expect(asked()).toBe(20);
    expect(toast()).toBeNull();
  });

  it('does not ask, or show anything, when the page is not opened from a purchase', async () => {
    const { advance, asked, toast } = await render(null);

    await advance(60_000);

    expect(asked()).toBe(0);
    expect(toast()).toBeNull();
  });

  it('shows the note only once per order, even if the page is opened again', async () => {
    const first = await render('42', ['SENT']);
    await first.advance(0);
    expect(first.toast()).toBe('Confirmation email sent');
    first.fixture.destroy();

    const again = await render('42', ['SENT']);
    await again.advance(10_000);

    expect(again.asked()).toBe(0);
    expect(again.toast()).toBeNull();
  });

  it('stops asking when the customer leaves the page', async () => {
    const { fixture, advance, asked } = await render('42', ['PENDING']);
    await advance(0);
    expect(asked()).toBe(1);

    fixture.destroy();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(asked()).toBe(1);
  });

  it('keeps a status region on the page so the note is announced to screen readers', async () => {
    const { host } = await render(null);

    const region = host.querySelector('.toast-region');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });
});
