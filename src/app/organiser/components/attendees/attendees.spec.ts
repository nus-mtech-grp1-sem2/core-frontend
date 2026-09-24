import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth';
import { Attendees } from './attendees';

describe('Attendees', () => {
  it('loads managed events and maps the current order-service attendee response', async () => {
    await TestBed.configureTestingModule({
      imports: [Attendees],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Attendees);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [{ event_id: 7, title: 'Postman Order Test' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/order/events/7/attendees').flush({
      attendees: [
        {
          order_id: 16,
          customer_email: 'buyer@example.com',
          paid_at: '2027-02-11T04:00:00.000Z',
          description: 'General Admission',
          quantity: 2,
          seat_id: null,
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Postman Order Test');
    expect(text).toContain('buyer@example.com');
    expect(text).toContain('General Admission');
    expect(text).toContain('2');
    expect(text).not.toContain("Couldn't load attendees");
    http.verify();
  });
});

describe('Attendees states and roster mapping', () => {
  const twoEvents = {
    events: [
      { event_id: 7, title: 'Postman Order Test' },
      { event_id: 8, title: 'Second Show' },
    ],
  };

  async function setup() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Attendees],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Attendees);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    /** Answers the events request, then the first event's roster request. */
    const loadRoster = async (events: object, attendees: readonly object[]) => {
      http.expectOne('/api/event/events/manage').flush(events);
      await settle();
      http.expectOne('/api/order/events/7/attendees').flush({ attendees });
      await settle();
    };
    const retry = () => host.querySelector<HTMLButtonElement>('button.retry')?.click();
    return { http, fixture, host, settle, loadRoster, retry };
  }

  const attendee = (overrides: Record<string, unknown> = {}) => ({
    order_id: 1,
    customer_email: 'buyer@example.com',
    paid_at: '2026-09-01T04:00:00Z',
    description: 'General Admission',
    quantity: 1,
    seat_id: null,
    ...overrides,
  });

  it('shows a loading message until the events arrive', async () => {
    const { host, http } = await setup();

    expect(host.textContent).toContain('Loading events…');
    expect(host.querySelector('#event')).toBeNull();
    http.expectOne('/api/event/events/manage');
  });

  it('offers a retry when the events cannot be loaded, and recovers on retry', async () => {
    const { host, http, settle, retry } = await setup();

    http
      .expectOne('/api/event/events/manage')
      .flush({ error: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(host.textContent).toContain("Couldn't load events.");
    expect(host.querySelector('#event')).toBeNull();

    retry();
    http.expectOne('/api/event/events/manage').flush(twoEvents);
    await settle();
    http.expectOne('/api/order/events/7/attendees').flush({ attendees: [] });
    await settle();

    expect(host.textContent).not.toContain("Couldn't load events.");
    expect(host.querySelectorAll('#event option')).toHaveLength(2);
    http.verify();
  });

  it('offers a retry when the roster cannot be loaded, and recovers on retry', async () => {
    const { host, http, settle, retry } = await setup();
    http.expectOne('/api/event/events/manage').flush(twoEvents);
    await settle();

    http
      .expectOne('/api/order/events/7/attendees')
      .flush({ error: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(host.textContent).toContain("Couldn't load attendees.");

    retry();
    http.expectOne('/api/order/events/7/attendees').flush({ attendees: [attendee()] });
    await settle();

    expect(host.textContent).not.toContain("Couldn't load attendees.");
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('lists the events in the filter and loads the roster of the first one', async () => {
    const { host, http, loadRoster } = await setup();

    await loadRoster(twoEvents, [attendee()]);

    const options = Array.from(host.querySelectorAll<HTMLOptionElement>('#event option'));
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Postman Order Test',
      'Second Show',
    ]);
    expect(host.querySelector('caption')?.textContent).toContain('Postman Order Test');
    http.verify();
  });

  it("loads the chosen event's roster when the filter changes", async () => {
    const { host, http, settle, loadRoster } = await setup();
    await loadRoster(twoEvents, [attendee({ customer_email: 'first@example.com' })]);

    const select = host.querySelector<HTMLSelectElement>('#event')!;
    select.value = '8';
    select.dispatchEvent(new Event('change'));
    await settle();
    http
      .expectOne('/api/order/events/8/attendees')
      .flush({ attendees: [attendee({ order_id: 2, customer_email: 'second@example.com' })] });
    await settle();

    expect(host.querySelector('caption')?.textContent).toContain('Second Show');
    expect(host.textContent).toContain('second@example.com');
    expect(host.textContent).not.toContain('first@example.com');
    http.verify();
  });

  it('says so when nobody has bought a ticket yet', async () => {
    const { host, http, loadRoster } = await setup();

    await loadRoster(twoEvents, []);

    expect(host.textContent).toContain('No one has bought a ticket for this event yet.');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('maps each order line to a row: buyer link, ticket type, quantity and order date', async () => {
    const { host, http, loadRoster } = await setup();

    await loadRoster(twoEvents, [
      attendee({ order_id: 1, description: 'VIP', quantity: '2' }),
      attendee({
        order_id: 2,
        customer_email: 'seat@example.com',
        description: '',
        seat_id: 12,
        paid_at: null,
      }),
      attendee({ order_id: 3, customer_email: 'ga@example.com', description: '', seat_id: null }),
    ]);

    const rows = Array.from(host.querySelectorAll('tbody tr')).map((row) => ({
      buyer: row.querySelector('th')?.textContent?.trim(),
      href: row.querySelector('a')?.getAttribute('href'),
      cells: Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim()),
    }));

    expect(rows[0]).toMatchObject({ buyer: 'buyer@example.com', href: 'mailto:buyer@example.com' });
    expect(rows[0]?.cells[1]).toBe('VIP');
    expect(rows[0]?.cells[2]).toBe('2');
    expect(rows[0]?.cells[3]).not.toBe('Not recorded');
    expect(rows[1]?.cells[1]).toBe('Seat 12');
    expect(rows[1]?.cells[3]).toBe('Not recorded');
    expect(rows[2]?.cells[1]).toBe('General admission');
    http.verify();
  });

  it('shows a legacy order with no recorded email without a broken mailto link', async () => {
    const { host, http, loadRoster } = await setup();

    await loadRoster(twoEvents, [attendee({ customer_email: '' })]);

    const row = host.querySelector('tbody tr')!;
    expect(row.querySelector('th')?.textContent?.trim()).toBe('Legacy customer');
    expect(row.querySelector('a')).toBeNull();
    expect(row.querySelector('td')?.textContent?.trim()).toBe('Not recorded');
    http.verify();
  });

  it('says there are no events, instead of a filter and a roster, when the organiser has none', async () => {
    const { host, http, settle } = await setup();

    http.expectOne('/api/event/events/manage').flush({ events: [] });
    await settle();

    expect(host.textContent).toContain("You don't have any events yet.");
    expect(host.textContent).not.toContain('Loading attendees…');
    expect(host.querySelector('#event')).toBeNull();
    expect(host.querySelector('table')).toBeNull();
    http.verify();
  });
});
