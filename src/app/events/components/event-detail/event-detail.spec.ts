import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../../core/api';
import { AuthService } from '../../../core/auth';
import { QueueService } from '../../../core/queue';
import { buyerCapacity, EventDetail, purchaseErrorMessage } from './event-detail';

describe('EventDetail checkout navigation', () => {
  it.each(['TIER1_GA', 'TIER2_SEATED'] as const)(
    'opens payment without paying for %s tickets',
    async (tier) => {
      const get = vi.fn((_service: string, path: string): Observable<unknown> => {
        if (path === '/events/172')
          return of({
            event: {
              event_id: 172,
              organiser_sub: 'owner',
              title: 'Test event',
              description: '',
              venue: 'Test Hall',
              starts_at: '2099-01-01 20:00:00',
              total_seats: 10,
              available_buyers: 2,
              tier,
              status: 'PUBLISHED',
              price_cents: 2000,
            },
          });
        if (path === '/helper/shifts') return of({ events: [] });
        if (path === '/customers/me/orders') return of({ orders: [] });
        if (path === '/customers/me/tickets') return of({ tickets: [] });
        if (path === '/events/172/seats')
          return of({ seats: [{ seat_id: 8, seat_label: 'A8', status: 'AVAILABLE' }] });
        return throwError(() => new Error(`Unexpected GET ${path}`));
      });
      const post = vi.fn(() => of({ order: { order_id: 42 } }));
      const clear = vi.fn();
      await TestBed.configureTestingModule({
        imports: [EventDetail],
        providers: [
          provideRouter([]),
          { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
          { provide: ApiService, useValue: { get, post } },
          {
            provide: AuthService,
            useValue: {
              isAuthenticated: () => true,
              user: signal({
                sub: 'customer',
                email: 'test@example.com',
                name: 'Test',
                groups: [],
              }),
            },
          },
          {
            provide: QueueService,
            useValue: {
              status: vi.fn().mockResolvedValue({
                status: 'ADMITTED',
                admissionToken: 'test-admission',
                tokenExpiresAt: '2099-01-01T20:00:00Z',
              }),
              admissionTokenFor: () => 'test-admission',
              clear,
            },
          },
        ],
      }).compileComponents();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(EventDetail);
      fixture.componentRef.setInput('id', '172');
      fixture.detectChanges();
      await new Promise<void>((resolve) => setTimeout(resolve));
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      if (tier === 'TIER2_SEATED') {
        host.querySelector<HTMLButtonElement>('button.seat')!.click();
        fixture.detectChanges();
      }
      const buy = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Buy tickets',
      );
      expect(buy).toBeDefined();
      buy!.click();
      await new Promise<void>((resolve) => setTimeout(resolve));
      expect(post).toHaveBeenCalledExactlyOnceWith('order', '/orders', {
        eventId: 172,
        quantity: 1,
        seatIds: tier === 'TIER2_SEATED' ? [8] : undefined,
        admissionToken: tier === 'TIER2_SEATED' ? 'test-admission' : undefined,
        customerEmail: 'test@example.com',
        customerName: 'Test',
      });
      expect(navigate).toHaveBeenCalledWith(['/checkout', 42]);
      expect(clear).not.toHaveBeenCalled();
    },
  );
});

describe('EventDetail buyer capacity', () => {
  it('uses the configured number of concurrent buyers', () => {
    expect(buyerCapacity(104, 1)).toBe(1);
  });

  it('falls back to ten percent rounded up, with a minimum of one', () => {
    expect(buyerCapacity(104, null)).toBe(11);
    expect(buyerCapacity(5, null)).toBe(1);
  });
});

describe('EventDetail purchase errors', () => {
  it('explains an inventory conflict instead of showing a generic failure', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { error: 'inventory_unavailable' },
    });

    expect(purchaseErrorMessage(error)).toContain('unavailable or sold out');
  });

  it('explains that an event-team member cannot purchase', () => {
    const error = new HttpErrorResponse({
      status: 403,
      error: { error: 'event_team_cannot_purchase' },
    });

    expect(purchaseErrorMessage(error)).toContain('Organisers and event helpers cannot purchase');
  });
});

describe('EventDetail event-team purchase restriction', () => {
  it('does not render purchase controls for an accepted event helper', async () => {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: '2099-09-20 20:00:00',
            total_seats: 10,
            available_buyers: 2,
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/helper/shifts') return of({ events: [{ event_id: 172 }] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { workspace: 'customer' } } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'helper-sub',
              email: 'helper@example.com',
              name: 'Helper',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('cannot purchase tickets for events they manage');
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Buy tickets',
      ),
    ).toBe(false);
  });
});

describe('EventDetail waiting-room controls', () => {
  it('opens the waiting room and manually admits a waiting customer', async () => {
    let queueLoads = 0;
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: '2099-09-20 20:00:00',
            total_seats: 10,
            available_buyers: 2,
            tier: 'TIER2_SEATED',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/events/172/team-members') return of({ members: [] });
      if (path === '/events/172/seats') return of({ seats: [] });
      if (path === '/events/172/queue') {
        queueLoads += 1;
        if (queueLoads === 1) {
          return throwError(() => new HttpErrorResponse({ status: 404 }));
        }
        return of({
          queue: {
            eventId: 172,
            admissionBatchSize: 2,
            status: 'OPEN',
            waitingCount: queueLoads === 2 ? 1 : 0,
          },
        });
      }
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const put = vi.fn(() => of({ queueSession: { status: 'OPEN' } }));
    const post = vi.fn(() => of({ admitted: 1, remaining: 0 }));

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { workspace: 'organiser' } } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'owner-sub',
              email: 'owner@example.com',
              name: 'Owner',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put, post, delete: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const buttons = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      );
    buttons()
      .find((button) => button.textContent?.trim() === 'Open waiting room')
      ?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(put).toHaveBeenCalledWith('queue', '/events/172/queue/config', {
      opensAt: expect.any(String),
      admissionBatchSize: 2,
      admissionIntervalSec: 60,
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The waiting room is open',
    );

    buttons()
      .find((button) => button.textContent?.trim() === 'Admit next customer')
      ?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('queue', '/events/172/queue/admit-next', {});
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 customer admitted.');
  });
});

describe('EventDetail completed events for an organiser', () => {
  async function renderOrganiser(startsAt: string) {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: startsAt,
            total_seats: 10,
            available_buyers: 2,
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/events/172/team-members') {
        return of({
          members: [
            {
              membership_id: 1,
              user_sub: 'helper-sub',
              user_email: 'helper@example.com',
              role: 'HELPER',
              invite_status: 'ACCEPTED',
            },
          ],
        });
      }
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const put = vi.fn(() => of({}));
    const post = vi.fn(() => of({}));
    const remove = vi.fn(() => of({}));

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'organiser' } } } },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'owner-sub',
              email: 'owner@example.com',
              name: 'Owner',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put, post, delete: remove } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    return { host, button, put, post, remove };
  }

  it('can be opened but not edited, and its team cannot be changed', async () => {
    const { host, button, put, post, remove } = await renderOrganiser('2020-01-01 20:00:00');

    expect(host.textContent).toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('Completed');
    for (const field of ['title', 'description', 'venue', 'starts-at', 'seats', 'price', 'tier']) {
      expect(host.querySelector<HTMLInputElement>(`#${field}`)?.disabled).toBe(true);
    }
    expect(host.querySelector<HTMLInputElement>('#member-email')?.disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('#member-role')?.disabled).toBe(true);
    for (const label of ['Save changes', 'Cancel event', 'Invite', 'Remove']) {
      expect(button(label)?.disabled, label).toBe(true);
    }

    for (const label of ['Save changes', 'Cancel event', 'Invite', 'Remove'])
      button(label)?.click();
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('stays fully editable while the event is still upcoming', async () => {
    const { host, button } = await renderOrganiser('2099-01-01 20:00:00');

    expect(host.textContent).not.toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('On sale');
    expect(host.querySelector<HTMLInputElement>('#title')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#member-email')?.disabled).toBe(false);
    for (const label of ['Save changes', 'Cancel event', 'Invite', 'Remove']) {
      expect(button(label)?.disabled, label).toBe(false);
    }
  });
});

describe('EventDetail completed events for a customer', () => {
  async function renderCustomer(options: {
    startsAt: string;
    tier?: 'TIER1_GA' | 'TIER2_SEATED';
    ownedTickets?: number;
  }) {
    const requested: string[] = [];
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      requested.push(path);
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: options.startsAt,
            total_seats: 10,
            available_buyers: 2,
            tier: options.tier ?? 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/helper/shifts') return of({ events: [] });
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/customers/me/tickets') {
        return of({
          tickets: Array.from({ length: options.ownedTickets ?? 0 }, () => ({
            event_id: 172,
            order_id: 9,
            status: 'ISSUED',
          })),
        });
      }
      if (path === '/events/172/seats') return of({ seats: [] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const post = vi.fn(() => of({}));

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'customer-sub',
              email: 'buyer@example.com',
              name: 'Buyer',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put: vi.fn(), post, delete: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const hasControl = (label: string) =>
      Array.from(host.querySelectorAll('button, a')).some(
        (element) => element.textContent?.trim() === label,
      );
    return { host, post, requested, hasControl };
  }

  const PAST = '2020-01-01 20:00:00';

  it('offers no way to buy tickets, and says the event has taken place', async () => {
    const { host, post, hasControl } = await renderCustomer({ startsAt: PAST });

    expect(host.textContent).toContain('This event has already taken place');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('Completed');
    expect(host.querySelector('.purchase[aria-label="Buy tickets"]')).toBeNull();
    for (const label of ['Buy tickets', 'Join waiting room', 'Buy more tickets']) {
      expect(hasControl(label), label).toBe(false);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('does not offer the waiting room, or load its seat map or queue, for a completed reserved-seating event', async () => {
    const { requested, hasControl } = await renderCustomer({
      startsAt: PAST,
      tier: 'TIER2_SEATED',
    });

    expect(hasControl('Join waiting room')).toBe(false);
    expect(requested).not.toContain('/events/172/seats');
    expect(requested.some((path) => path.includes('/queue'))).toBe(false);
  });

  it('points a customer who holds tickets to them', async () => {
    const { host, hasControl } = await renderCustomer({ startsAt: PAST, ownedTickets: 2 });

    expect(hasControl('View my tickets')).toBe(true);
    expect(host.querySelector('a[href="/my-events"]')).not.toBeNull();
  });

  it('shows no tickets link to a customer who holds none', async () => {
    const { hasControl } = await renderCustomer({ startsAt: PAST });

    expect(hasControl('View my tickets')).toBe(false);
  });

  it('still lets customers buy while the event is upcoming', async () => {
    const { host, hasControl } = await renderCustomer({ startsAt: '2099-01-01 20:00:00' });

    expect(hasControl('Buy tickets')).toBe(true);
    expect(host.textContent).not.toContain('This event has already taken place');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('On sale');
  });

  it('explains the server refusing an order for a completed event', () => {
    const error = new HttpErrorResponse({ status: 409, error: { error: 'event_completed' } });

    expect(purchaseErrorMessage(error)).toContain('already taken place');
  });
});
