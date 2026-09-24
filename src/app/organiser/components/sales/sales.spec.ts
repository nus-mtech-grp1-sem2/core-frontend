import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth';
import { formatEventDate, formatEventTime } from '../../../core/event-time';
import { Sales } from './sales';

describe('Sales', () => {
  it('combines managed events with current order-service sales summaries', async () => {
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [
        {
          event_id: 7,
          title: 'Postman Order Test',
          venue: 'Test Hall',
          total_seats: 10,
          remaining_qty: 6,
          status: 'PUBLISHED',
        },
      ],
    });
    await Promise.resolve();

    http.expectOne('/api/order/events/7/orders/summary').flush({
      paidOrders: 2,
      ticketsSold: 4,
      revenueCents: 20_000,
      averageOrderCents: 10_000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Postman Order Test');
    expect(text).toContain('Test Hall');
    expect(text).toContain('4 / 10');
    expect(text).toContain('S$200');
    expect(text).toContain('S$100');
    expect(text).not.toContain("Couldn't load sales figures");
    http.verify();
  });

  it('keeps the event visible when its sales summary is temporarily unavailable', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [
        {
          event_id: 8,
          title: 'No Orders Yet',
          venue: 'Test Hall',
          total_seats: 20,
          remaining_qty: 20,
          status: 'PUBLISHED',
        },
      ],
    });
    await Promise.resolve();
    http
      .expectOne('/api/order/events/8/orders/summary')
      .flush({ error: 'temporary_failure' }, { status: 502, statusText: 'Bad Gateway' });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No Orders Yet');
    expect(text).toContain('0 / 20');
    expect(text).not.toContain("Couldn't load sales figures");
    http.verify();
  });

  it('shows the event date and time before the status, and marks past events Completed', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();

    const day = 24 * 60 * 60 * 1000;
    const startsAt = new Date(Date.now() + 7 * day);
    const managed = (id: number, title: string, remaining: number, overrides = {}) => ({
      event_id: id,
      title,
      venue: 'Test Hall',
      starts_at: startsAt.toISOString(),
      total_seats: 10,
      remaining_qty: remaining,
      status: 'PUBLISHED',
      ...overrides,
    });
    http.expectOne('/api/event/events/manage').flush({
      events: [
        managed(1, 'Held Not Sold', 0),
        managed(2, 'Truly Sold Out', 0),
        managed(3, 'Plenty Left', 8),
        managed(4, 'Already Happened', 5, {
          starts_at: new Date(Date.now() - day).toISOString(),
        }),
        managed(5, 'Called Off', 3, { status: 'CANCELLED' }),
      ],
    });
    await Promise.resolve();
    const ticketsSold: Record<number, number> = { 1: 4, 2: 10, 3: 2, 4: 5, 5: 0 };
    for (const [id, sold] of Object.entries(ticketsSold)) {
      http
        .expectOne(`/api/order/events/${id}/orders/summary`)
        .flush({ paidOrders: sold, ticketsSold: sold, revenueCents: sold * 1_000 });
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      Array.from(host.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toEqual(['Event', 'Venue', 'Tickets sold', 'Revenue', 'Event date', 'Event time', 'Status']);

    const cells = (title: string) => {
      const row = Array.from(host.querySelectorAll('tbody tr')).find((tr) =>
        tr.querySelector('th')?.textContent?.includes(title),
      )!;
      return Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim());
    };
    expect(cells('Plenty Left').slice(3)).toEqual([
      formatEventDate(startsAt),
      formatEventTime(startsAt),
      'On sale',
    ]);
    // Stock that is only held mid-checkout (remaining 0, 4 of 10 sold) is not sold out.
    expect(cells('Held Not Sold')[5]).toBe('Few left');
    expect(cells('Truly Sold Out')[5]).toBe('Sold out');
    expect(cells('Already Happened')[5]).toBe('Completed');
    expect(cells('Called Off')[5]).toBe('Cancelled');
    http.verify();
  });
});

describe('Sales overview states and totals', () => {
  async function setup() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const tick = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    };
    /** Answers the events request, then each event's sales summary. */
    const load = async (
      events: readonly { event_id: number }[],
      summaries: Record<number, object> = {},
    ) => {
      http.expectOne('/api/event/events/manage').flush({ events });
      await Promise.resolve();
      for (const event of events) {
        http
          .expectOne(`/api/order/events/${event.event_id}/orders/summary`)
          .flush(summaries[event.event_id] ?? { paidOrders: 0, ticketsSold: 0, revenueCents: 0 });
      }
      await tick();
    };
    return { http, host, tick, load };
  }

  const managed = (id: number, title = `Event ${id}`) => ({
    event_id: id,
    title,
    venue: 'Test Hall',
    starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    total_seats: 100,
    remaining_qty: 50,
    status: 'PUBLISHED',
  });
  const stats = (host: HTMLElement) =>
    Object.fromEntries(
      Array.from(host.querySelectorAll('.stats li')).map((li) => [
        li.querySelector('.stat-label')?.textContent?.trim(),
        li.querySelector('.stat-value')?.textContent?.trim(),
      ]),
    );

  it('shows a loading message, then the sales table', async () => {
    const { host, http, load } = await setup();

    expect(host.textContent).toContain('Loading sales…');
    expect(host.querySelector('table')).toBeNull();

    await load([managed(1)]);

    expect(host.textContent).not.toContain('Loading sales…');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('offers a retry when the events cannot be loaded, and recovers on retry', async () => {
    const { host, http, tick, load } = await setup();

    http
      .expectOne('/api/event/events/manage')
      .flush({ error: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    await tick();
    expect(host.textContent).toContain("Couldn't load sales figures.");
    expect(host.querySelector('table')).toBeNull();

    host.querySelector<HTMLButtonElement>('button.retry')?.click();
    await load([managed(1)]);

    expect(host.textContent).not.toContain("Couldn't load sales figures.");
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('totals revenue and tickets sold across events, and averages revenue per paid order', async () => {
    const { host, http, load } = await setup();

    await load([managed(1), managed(2)], {
      1: { paidOrders: 2, ticketsSold: 4, revenueCents: 20_000 },
      2: { paidOrders: 1, ticketsSold: 6, revenueCents: 30_000 },
    });

    expect(stats(host)).toEqual({
      'Total revenue': 'S$500',
      'Tickets sold': '10',
      'Average order value': 'S$167',
    });
    http.verify();
  });

  it('shows zeroes rather than NaN when nothing has been sold', async () => {
    const { host, http, load } = await setup();

    await load([managed(1)]);

    expect(stats(host)).toEqual({
      'Total revenue': 'S$0',
      'Tickets sold': '0',
      'Average order value': 'S$0',
    });
    expect(host.textContent).not.toContain('NaN');
    http.verify();
  });

  it('shows the totals and an empty table for an organiser with no events', async () => {
    const { host, http, load } = await setup();

    await load([]);

    expect(stats(host)['Tickets sold']).toBe('0');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
    http.verify();
  });

  it('keeps the other events, and their totals, when one sales summary fails', async () => {
    const { host, http, tick } = await setup();

    http.expectOne('/api/event/events/manage').flush({ events: [managed(1), managed(2)] });
    await Promise.resolve();
    http
      .expectOne('/api/order/events/1/orders/summary')
      .flush({ error: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    http
      .expectOne('/api/order/events/2/orders/summary')
      .flush({ paidOrders: 1, ticketsSold: 3, revenueCents: 9_000 });
    await tick();

    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(stats(host)).toMatchObject({ 'Total revenue': 'S$90', 'Tickets sold': '3' });
    http.verify();
  });
});
