import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, vi } from 'vitest';

import { ApiService } from '../core/api';
import { MyEvents } from './my-events';

// Rendering issued tickets builds a QR image; a stub keeps that out of these tests.
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,AA==') }));

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

describe('MyEvents only lists events happening today or later', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const at = (daysFromNow: number) => new Date(Date.now() + daysFromNow * DAY_MS).toISOString();
  const ticket = (id: number, title: string, daysFromNow: number) => ({
    ticket_id: id,
    order_id: 100 + id,
    event_id: id,
    event_title: title,
    venue: 'Test Hall',
    starts_at: at(daysFromNow),
    seat_label: null,
    qr_token: `token-${id}`,
    status: 'ISSUED',
  });
  const paidOrder = (id: number, title: string, daysFromNow: number) => ({
    order_id: 200 + id,
    event_id: id,
    status: 'PAID',
    total_amount_cents: 2_000,
    currency: 'SGD',
    paid_at: null,
    event_title: title,
    venue: 'Test Hall',
    starts_at: at(daysFromNow),
    ticket_count: 1,
  });

  async function render(tickets: readonly object[], orders: readonly object[]) {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets') return of({ tickets });
      if (path === '/customers/me/orders') return of({ orders });
      if (path === '/helper/shifts') return of({ events: [] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    TestBed.resetTestingModule();
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

  const titles = (root: HTMLElement, selector: string) =>
    Array.from(root.querySelectorAll(`${selector} .ticket-card h2`)).map(
      (el) => el.textContent?.trim() ?? '',
    );

  it('drops tickets for events on earlier days and keeps today and later', async () => {
    const root = await render(
      [
        ticket(1, 'Last week', -10),
        ticket(2, 'Last night', -1),
        ticket(3, 'Tonight', 0),
        ticket(4, 'Next week', 7),
      ],
      [],
    );

    expect(titles(root, '.ticket-list')).toEqual(['Tonight', 'Next week']);
  });

  it('drops paid orders still waiting for a ticket the same way', async () => {
    const root = await render(
      [],
      [paidOrder(1, 'Last week', -10), paidOrder(2, 'Tonight', 0), paidOrder(3, 'Next week', 7)],
    );

    expect(titles(root, '.pending-list')).toEqual(['Tonight', 'Next week']);
  });

  it('lists nothing when every ticket is for an earlier day', async () => {
    const root = await render([ticket(1, 'Last week', -10)], [paidOrder(2, 'Last month', -30)]);

    expect(root.querySelectorAll('.ticket-card').length).toBe(0);
  });
});
