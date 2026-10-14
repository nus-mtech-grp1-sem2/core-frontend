import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { Events, pageWindow } from './events';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', name: 'Someone Example', groups };
}

const MOCK_EVENTS = [
  {
    event_id: 1,
    title: 'Neon Skyline Tour',
    description: null,
    venue: 'Marina Bay Arena',
    starts_at: '2099-09-12 20:00:00',
    total_seats: 500,
    available_buyers: null,
    tier: 'TIER1_GA',
    status: 'PUBLISHED',
    price_cents: 8800,
  },
  {
    event_id: 2,
    title: 'ASEAN Cup Final',
    description: null,
    venue: 'Kallang Grand Stadium',
    starts_at: '2099-09-28 17:00:00',
    total_seats: 2000,
    available_buyers: 25,
    tier: 'TIER2_SEATED',
    status: 'PUBLISHED',
    price_cents: 4500,
  },
] as const;

async function renderFor(current: AuthenticatedUser | null, query = '') {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Events],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CognitoGateway,
        useValue: { currentUser: async () => current, signOut: async () => undefined },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: current?.groups.includes('organiser')
              ? { workspace: 'organiser' }
              : { workspace: 'customer' },
            queryParamMap: convertToParamMap(query ? { q: query } : {}),
          },
          queryParamMap: of(convertToParamMap(query ? { q: query } : {})),
        },
      },
    ],
  }).compileComponents();

  await TestBed.inject(AuthService).restore();
  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Events);
  fixture.detectChanges();

  return { fixture, httpMock, host: fixture.nativeElement as HTMLElement };
}

describe('Events', () => {
  it('lists every event for a signed-out visitor, without organiser controls', async () => {
    const { fixture, httpMock, host } = await renderFor(null);

    httpMock.expectOne('/api/event/events').flush({ events: MOCK_EVENTS });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    for (const event of MOCK_EVENTS) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(2);
    expect(host.textContent).toContain('Join waiting room');
    expect(host.textContent).toContain('View tickets');
    expect(host.textContent).not.toContain('New event');
    httpMock.verify();
  });

  it('lets an organiser open the new-event form', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));

    httpMock.expectOne('/api/event/events/manage').flush({ events: MOCK_EVENTS });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(2);
    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'New event',
    );
    expect(toggle).toBeTruthy();

    toggle?.click();
    await fixture.whenStable();

    expect(host.querySelector('#event-title')).not.toBeNull();
    // Seats come from Configure inventory, and available buyers is set on the
    // event page once there are seats, so neither is asked for up front.
    expect(host.querySelector('#event-total-seats')).toBeNull();
    expect(host.querySelector('#event-available-buyers')).toBeNull();
    httpMock.verify();
  });

  it('goes straight to Configure inventory after creating a new event', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));

    httpMock.expectOne('/api/event/events/manage').flush({ events: [] });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'New event',
    )!;
    toggle.click();
    await fixture.whenStable();
    fixture.detectChanges();

    host.querySelector<HTMLInputElement>('#event-title')!.value = 'Neon Skyline Tour';
    host.querySelector<HTMLInputElement>('#event-title')!.dispatchEvent(new Event('input'));
    host.querySelector<HTMLInputElement>('#event-venue')!.value = 'Marina Bay Arena';
    host.querySelector<HTMLInputElement>('#event-venue')!.dispatchEvent(new Event('input'));
    host.querySelector<HTMLInputElement>('#event-start')!.value = '2099-09-12T20:00';
    host.querySelector<HTMLInputElement>('#event-start')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    host.querySelector<HTMLFormElement>('.new-event-form')!.dispatchEvent(new Event('submit'));
    const create = httpMock.expectOne('/api/event/events');
    expect(create.request.method).toBe('POST');
    create.flush({ eventId: 99 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/organiser/events', 99, 'inventory']);
  });

  it('creates an event with the local start time that was picked sent as UTC', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));

    httpMock.expectOne('/api/event/events/manage').flush({ events: [] });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'New event')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    for (const [id, value] of [
      ['event-title', 'Welcome Party NUS'],
      ['event-venue', 'NUS ISS'],
      ['event-start', '2099-10-12T23:13'],
    ]) {
      const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    host.querySelector<HTMLFormElement>('.new-event-form')!.dispatchEvent(new Event('submit'));
    await new Promise<void>((resolve) => setTimeout(resolve));

    const create = httpMock.expectOne({ method: 'POST', url: '/api/event/events' });
    expect(create.request.body.startsAt).toBe(new Date(2099, 9, 12, 23, 13).toISOString());
    create.flush({ eventId: 9 });
    await fixture.whenStable();
  });

  it('hides completed events from an organiser until asked, and offers no actions on them', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));
    const completed = {
      ...MOCK_EVENTS[0],
      event_id: 3,
      title: 'Old Farewell Show',
      starts_at: '2020-01-01 20:00:00',
    };

    httpMock.expectOne('/api/event/events/manage').flush({ events: [...MOCK_EVENTS, completed] });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const include = host.querySelector<HTMLInputElement>('.include-completed input')!;
    expect(include.checked).toBe(false);
    expect(host.querySelectorAll('.event-card')).toHaveLength(2);
    expect(host.textContent).not.toContain('Old Farewell Show');

    include.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(3);
    const card = Array.from(host.querySelectorAll('.event-card')).find((element) =>
      element.textContent?.includes('Old Farewell Show'),
    )!;
    expect(card.textContent).toContain('Completed');
    expect(card.querySelector('.actions')).toBeNull();
    expect(card.querySelector('a.thumb')?.getAttribute('href')).toBe('/organiser/events/3');
    const upcoming = host.querySelector('.event-card .actions');
    expect(upcoming?.textContent).toContain('Cancel');
    httpMock.verify();
  });

  describe('completed events for a customer', () => {
    const past = { ...MOCK_EVENTS[0], starts_at: '2020-01-01 20:00:00' };
    const upcomingSeated = MOCK_EVENTS[1];
    const pastSeated = {
      ...MOCK_EVENTS[1],
      event_id: 3,
      title: 'Old Cup Final',
      starts_at: '2020-01-01 17:00:00',
    };

    async function renderCustomerList(query = '') {
      const rendered = await renderFor(null, query);
      const { fixture, httpMock } = rendered;
      httpMock.expectOne('/api/event/events').flush({ events: [past, upcomingSeated, pastSeated] });
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      for (const event of [past, upcomingSeated, pastSeated]) {
        httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
      }
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      const cards = () => Array.from(rendered.host.querySelectorAll('.event-card'));
      const card = (title: string) =>
        cards().find((element) => element.textContent?.includes(title));
      const checkbox = rendered.host.querySelector<HTMLInputElement>('.include-completed input')!;
      return { ...rendered, cards, card, checkbox };
    }

    it('offers an "Include completed events" checkbox, unchecked by default', async () => {
      const { checkbox, host } = await renderCustomerList();

      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(false);
      expect(host.querySelector('.include-completed')?.textContent).toContain(
        'Include completed events',
      );
      // Organiser-only controls stay organiser-only.
      expect(host.querySelector('.include-cancelled')).toBeNull();
    });

    it('hides completed events until the checkbox is ticked, and counts only what is shown', async () => {
      const { cards, card, host, httpMock } = await renderCustomerList();

      expect(cards()).toHaveLength(1);
      expect(card('ASEAN Cup Final')).toBeTruthy();
      expect(card('Neon Skyline Tour')).toBeUndefined();
      expect(card('Old Cup Final')).toBeUndefined();
      expect(host.querySelector('.count')?.textContent?.trim()).toBe('1 events');
      httpMock.verify();
    });

    it('shows completed events, marked Completed and with no way to buy, once ticked', async () => {
      const { checkbox, cards, card, fixture, host, httpMock } = await renderCustomerList();

      checkbox.click();
      fixture.detectChanges();

      expect(cards()).toHaveLength(3);
      expect(host.querySelector('.count')?.textContent?.trim()).toBe('3 events');
      for (const title of ['Neon Skyline Tour', 'Old Cup Final']) {
        expect(card(title)?.querySelector('.status')?.textContent?.trim(), title).toBe('Completed');
        expect(card(title)?.querySelector('.customer-action a'), title).toBeNull();
      }
      // An upcoming event is still bought from its card.
      expect(card('ASEAN Cup Final')?.querySelector('.customer-action a')?.textContent).toContain(
        'Join waiting room',
      );
      httpMock.verify();
    });

    it('hides them again when the checkbox is cleared', async () => {
      const { checkbox, cards, fixture, httpMock } = await renderCustomerList();

      checkbox.click();
      fixture.detectChanges();
      checkbox.click();
      fixture.detectChanges();

      expect(cards()).toHaveLength(1);
      httpMock.verify();
    });

    it('applies the search to completed events too, once they are included', async () => {
      const { checkbox, cards, card, fixture, host, httpMock } =
        await renderCustomerList('old cup');

      expect(cards()).toHaveLength(0);
      expect(host.textContent).toContain('No events match your search.');

      checkbox.click();
      fixture.detectChanges();

      expect(cards()).toHaveLength(1);
      expect(card('Old Cup Final')).toBeTruthy();
      httpMock.verify();
    });
  });

  it('shows team-managed events in the signed-in customer catalogue', async () => {
    const { fixture, httpMock, host } = await renderFor(user([]));

    httpMock.expectOne('/api/event/events').flush({ events: MOCK_EVENTS });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    httpMock.expectOne('/api/order/customers/me/orders').flush({ orders: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    for (const event of MOCK_EVENTS) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(2);
    expect(host.textContent).toContain('Neon Skyline Tour');
    expect(host.textContent).toContain('ASEAN Cup Final');
    httpMock.verify();
  });

  it('shows an unpaid reservation with payment and cancellation controls', async () => {
    const { fixture, httpMock, host } = await renderFor(user([]));

    httpMock.expectOne('/api/event/events').flush({ events: MOCK_EVENTS });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    httpMock.expectOne('/api/order/customers/me/orders').flush({
      orders: [
        {
          order_id: 42,
          event_id: 1,
          status: 'PENDING',
          created_at: new Date(Date.now() - 1_000).toISOString(),
          reservation_expires_at: new Date(Date.now() + 180_000).toISOString(),
          event_title: 'Neon Skyline Tour',
          ticket_count: 2,
        },
      ],
    });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    for (const event of MOCK_EVENTS) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await fixture.whenStable();
    fixture.detectChanges();

    const reservations = host.querySelector('.active-reservations');
    expect(reservations?.textContent).toContain('Neon Skyline Tour');
    expect(reservations?.textContent).toContain('Continue to payment');
    expect(reservations?.textContent).toContain('Cancel reservation');
    expect(reservations?.querySelector('a')?.getAttribute('href')).toBe('/checkout/42');

    reservations?.querySelector<HTMLButtonElement>('button')?.click();
    const cancel = httpMock.expectOne('/api/order/orders/42/cancel');
    expect(cancel.request.method).toBe('POST');
    expect(cancel.request.body).toEqual({});
    cancel.flush(null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.active-reservations')).toBeNull();
    httpMock.verify();
  });

  it('filters the catalogue by title, venue, or description from the search query', async () => {
    const { fixture, httpMock, host } = await renderFor(null, 'kallang');

    httpMock.expectOne('/api/event/events').flush({ events: MOCK_EVENTS });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    for (const event of MOCK_EVENTS) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(1);
    expect(host.textContent).toContain('ASEAN Cup Final');
    expect(host.textContent).not.toContain('Neon Skyline Tour');
    httpMock.verify();
  });
});

describe('paging the customer list', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const many = Array.from({ length: 23 }, (_, index) => ({
    ...MOCK_EVENTS[0],
    event_id: index + 1,
    title: `Event ${index + 1}`,
    starts_at: `2099-10-${String(index + 1).padStart(2, '0')} 20:00:00`,
  }));

  async function renderCustomer() {
    const rendered = await renderFor(null);
    const { fixture, httpMock, host } = rendered;
    httpMock.expectOne('/api/event/events').flush({ events: many });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    for (const event of many) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const titles = () =>
      Array.from(host.querySelectorAll('.event-card h3')).map((title) => title.textContent?.trim());
    const button = (name: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.pager button')).find(
        (candidate) =>
          candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name,
      );
    const count = () => host.querySelector('.count')?.textContent?.trim();
    return { ...rendered, titles, button, count };
  }

  it('shows 10 events per page by default, starting on the first page', async () => {
    const { titles, button, count, host } = await renderCustomer();

    expect(titles()).toEqual(many.slice(0, 10).map((event) => event.title));
    expect(count()).toBe('Showing 1–10 of 23 events');
    expect(host.querySelector<HTMLSelectElement>('#page-size')?.value).toBe('10');
    expect(button('Previous')?.disabled).toBe(true);
    expect(button('Page 1')?.getAttribute('aria-current')).toBe('page');
    expect(button('Page 3')).toBeTruthy();
  });

  it('moves between pages and returns focus to the top of the list', async () => {
    const { fixture, titles, button, count, host } = await renderCustomer();

    button('Next')!.click();
    fixture.detectChanges();
    expect(titles()).toEqual(many.slice(10, 20).map((event) => event.title));
    expect(count()).toBe('Showing 11–20 of 23 events');
    expect(document.activeElement).toBe(host.querySelector('.count'));

    button('Page 3')!.click();
    fixture.detectChanges();
    expect(titles()).toEqual(['Event 21', 'Event 22', 'Event 23']);
    expect(button('Next')?.disabled).toBe(true);
    expect(button('Page 3')?.getAttribute('aria-current')).toBe('page');
  });

  it('lets the customer pick how many to show, and remembers it', async () => {
    const { fixture, titles, count, host } = await renderCustomer();
    host.querySelector<HTMLButtonElement>('.pager button[aria-label="Page 2"]')!.click();
    fixture.detectChanges();

    const select = host.querySelector<HTMLSelectElement>('#page-size')!;
    select.value = '20';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(titles()).toHaveLength(20);
    expect(titles()[0]).toBe('Event 1');
    expect(count()).toBe('Showing 1–20 of 23 events');
    expect(localStorage.getItem('onestage.eventsPageSize')).toBe('20');

    const again = await renderCustomer();
    expect(again.titles()).toHaveLength(20);
    expect(again.host.querySelector<HTMLSelectElement>('#page-size')?.value).toBe('20');
  });

  it('keeps an organiser’s whole list on one page, with no paging controls', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));
    httpMock.expectOne('/api/event/events/manage').flush({ events: many });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card')).toHaveLength(23);
    expect(host.querySelector('.pager')).toBeNull();
    expect(host.querySelector('#page-size')).toBeNull();
  });
});

describe('pageWindow', () => {
  it('lists every page when there are only a few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first, last and neighbouring pages, marking gaps with null', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, null, 20]);
  });
});
