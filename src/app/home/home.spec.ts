import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser } from '../core/cognito-gateway';
import { paidOrderFixture, startsInDays, ticketFixture } from '../testing/customer-fixtures';
import { Home } from './home';

const authUser = signal<AuthenticatedUser | null>(null);
const authenticated = signal(false);
const authStub = {
  user: authUser.asReadonly(),
  status: computed(() => (authenticated() ? 'authenticated' : 'anonymous')),
  isAuthenticated: computed(() => authenticated()),
  signOut: async () => undefined,
};

describe('Home', () => {
  beforeEach(async () => {
    authenticated.set(false);
    authUser.set(null);
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub },
      ],
    }).compileComponents();
  });

  it('renders every venue with bundled artwork and alt text', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({
      venues: Array.from({ length: 9 }, (_, index) => ({
        venue: `Venue ${index}`,
        upcoming: 1,
        sample_event_id: index + 1,
      })),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const images = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
    ) as HTMLImageElement[];

    expect(images.length).toBe(6);
    const sources = new Set(images.map((image) => image.getAttribute('src')));
    expect(sources.size).toBe(6);
    for (const img of images) {
      expect(img.getAttribute('src')).toContain('images/venue-');
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(0);
    }
    httpMock.verify();
  });

  it('shows the product story to a signed-out visitor', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    // Signed out: the pitch is the point.
    expect(host.querySelector('.assurances')).not.toBeNull();
    expect(host.querySelector('#about-heading')?.textContent).toContain('One place');
    expect(host.querySelectorAll('.feature-grid li').length).toBe(4);
    expect(host.querySelector('.cta')).not.toBeNull();
    httpMock.verify();
  });

  it('features only the next three events that have not started, soonest first', async () => {
    const event = (event_id: number, event_name: string, days: number, status = 'PUBLISHED') => ({
      event_id,
      event_name,
      event_type: 'TIER1_GA',
      event_start_datetime: startsInDays(days),
      status,
    });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    // The service lists past events too, oldest first.
    httpMock.expectOne('/api/event/events').flush({
      events: [
        event(1, 'Last month', -30),
        event(2, 'Earlier today', -0.1),
        event(3, 'Next month', 30),
        event(4, 'Cancelled tomorrow', 1, 'CANCELLED'),
        event(5, 'Next week', 7),
        event(6, 'Tomorrow', 1),
        event(7, 'Next year', 365),
      ],
    });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const titles = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.slide h1'),
      (heading) => heading.textContent?.trim(),
    );
    expect(titles).toEqual(['Tomorrow', 'Next week', 'Next month']);
    httpMock.verify();
  });

  it("dates a featured event in Singapore time, regardless of the viewer's own timezone", async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    // 4:30pm UTC on 1 Mar is already 12:30am on 2 Mar in Singapore.
    httpMock.expectOne('/api/event/events').flush({
      events: [
        { event_id: 1, event_name: 'Late show', event_start_datetime: '2099-03-01T16:30:00Z' },
      ],
    });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const date = (fixture.nativeElement as HTMLElement).querySelector('.slide .meta li');
    expect(date?.textContent?.trim()).toBe('2 Mar 2099 · 12:30 am');
    httpMock.verify();
  });

  it('shows no featured carousel when every event has already started', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({
      events: [{ event_id: 1, event_name: 'Last week', event_start_datetime: startsInDays(-7) }],
    });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.hero')).toBeNull();
    httpMock.verify();
  });

  async function renderSignedIn(tickets: readonly object[], orders: readonly object[] = []) {
    authenticated.set(true);
    authUser.set({ sub: 'customer-1', email: 'customer@example.com', name: '', groups: [] });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    httpMock.expectOne('/api/ticket/customers/me/tickets').flush({ tickets });
    httpMock.expectOne('/api/order/customers/me/orders').flush({ orders });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.verify();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a paid purchase while its ticket is still being issued', async () => {
    const root = await renderSignedIn(
      [],
      [
        {
          order_id: 17,
          event_id: 172,
          status: 'PAID',
          event_title: 'Postman Tier 2 Test',
          venue: 'Test Theatre',
          starts_at: startsInDays(30),
          ticket_count: 2,
        },
      ],
    );
    const text = root.textContent ?? '';

    expect(text).toContain('Postman Tier 2 Test');
    expect(text).toContain('2 tickets');
    expect(text).toContain('Payment received · issuing ticket');
  });

  describe('upcoming tickets', () => {
    const listed = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('.orders .order-event')).map(
        (el) => el.textContent?.trim() ?? '',
      );

    it('lists only events happening today or later, soonest first', async () => {
      const root = await renderSignedIn([
        ticketFixture(1, 'Last week', -10),
        ticketFixture(2, 'Last night', -1),
        ticketFixture(3, 'Next week', 7),
        ticketFixture(4, 'Tonight', 0),
      ]);

      expect(listed(root)).toEqual(['Tonight', 'Next week']);
    });

    it('does not let past tickets take up the five visible places', async () => {
      const root = await renderSignedIn([
        ticketFixture(1, 'Past A', -30),
        ticketFixture(2, 'Past B', -20),
        ticketFixture(3, 'Past C', -10),
        ...[1, 2, 3, 4, 5, 6].map((day) => ticketFixture(10 + day, `Future ${day}`, day)),
      ]);

      expect(listed(root)).toEqual(['Future 1', 'Future 2', 'Future 3', 'Future 4', 'Future 5']);
    });

    it('drops paid orders still waiting for a ticket when their event was on an earlier day', async () => {
      const root = await renderSignedIn(
        [],
        [paidOrderFixture(1, 'Last month', -30), paidOrderFixture(2, 'Next week', 7)],
      );

      expect(listed(root)).toEqual(['Next week']);
    });

    it('says there is nothing upcoming when every ticket is for an earlier day', async () => {
      const root = await renderSignedIn([ticketFixture(1, 'Last week', -10)]);

      expect(listed(root)).toEqual([]);
      expect(root.querySelector('.no-orders')?.textContent).toContain('No upcoming tickets yet');
    });
  });

  it('shows an unpaid reservation on the default route and allows cancellation', async () => {
    authenticated.set(true);
    authUser.set({ sub: 'customer-1', email: 'customer@example.com', name: '', groups: [] });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    httpMock.expectOne('/api/ticket/customers/me/tickets').flush({ tickets: [] });
    httpMock.expectOne('/api/order/customers/me/orders').flush({
      orders: [
        {
          order_id: 42,
          event_id: 172,
          status: 'PENDING',
          event_title: 'Reserved show',
          venue: 'Test Theatre',
          starts_at: '2027-02-11T04:00:00.000Z',
          ticket_count: 2,
          created_at: new Date(Date.now() - 1_000).toISOString(),
          reservation_expires_at: new Date(Date.now() + 180_000).toISOString(),
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const reservation = (fixture.nativeElement as HTMLElement).querySelector(
      '.active-reservations',
    );
    expect(reservation?.textContent).toContain('Reserved show');
    expect(reservation?.textContent).toContain('Continue to payment');
    expect(reservation?.querySelector('a')?.getAttribute('href')).toBe('/checkout/42');

    reservation?.querySelector<HTMLButtonElement>('button')?.click();
    const cancel = httpMock.expectOne('/api/order/orders/42/cancel');
    expect(cancel.request.body).toEqual({});
    cancel.flush(null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.active-reservations')).toBeNull();
    httpMock.verify();
  });
});
