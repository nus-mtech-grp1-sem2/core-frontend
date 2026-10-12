import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../../core/api';
import { AuthService } from '../../../core/auth';
import { QueueService } from '../../../core/queue';
import {
  buyerCapacity,
  defaultSeatGridColumns,
  EventDetail,
  purchaseErrorMessage,
  seatsWithFallbackLayout,
} from './event-detail';

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
        if (path === '/events/172/zones')
          return of({
            zones: [
              { inventoryItemId: 5, name: 'General Admission', priceCents: 2000, color: '#000', remaining: 10 },
            ],
          });
        if (path === '/events/172/seats')
          return of({
            gridRows: 1,
            gridCols: 1,
            seats: [
              {
                seatId: 8,
                seatLabel: 'A8',
                gridRow: 0,
                gridCol: 0,
                inventoryItemId: 1,
                sectionName: 'Floor',
                priceCents: 2000,
                color: '#000000',
                status: 'AVAILABLE',
                tag: 'NONE',
              },
            ],
          });
        return throwError(() => new Error(`Unexpected GET ${path}`));
      });
      const post = vi.fn(() => of({ order: { order_id: 42 } }));
      const clear = vi.fn();
      await TestBed.configureTestingModule({
        imports: [EventDetail],
        providers: [
          provideRouter([]),
          { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
          { provide: ApiService, useValue: { get, post, url: vi.fn(() => 'mock-image-url') } },
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
        const seat = host.querySelector<HTMLButtonElement>('button.seat')!;
        expect(seat.getAttribute('aria-pressed')).toBe('false');
        seat.click();
        fixture.detectChanges();
        expect(seat.getAttribute('aria-pressed')).toBe('true');
        seat.click();
        fixture.detectChanges();
        expect(seat.getAttribute('aria-pressed')).toBe('false');
        seat.click();
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
        inventoryItemId: tier === 'TIER1_GA' ? 5 : undefined,
        customerEmail: 'test@example.com',
        customerName: 'Test',
      });
      expect(navigate).toHaveBeenCalledWith(['/checkout', 42]);
      expect(clear).not.toHaveBeenCalled();
    },
  );
});

describe('EventDetail seat map sizing', () => {
  it("sizes seat cells the same fixed size as the organiser's zone-drawing view, instead of stretching to fill the purchase panel", async () => {
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
            tier: 'TIER2_SEATED',
            status: 'PUBLISHED',
            price_cents: 2000,
          },
        });
      if (path === '/helper/shifts') return of({ events: [] });
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/customers/me/tickets') return of({ tickets: [] });
      if (path === '/events/172/seats')
        // The saved canvas is much larger than its two occupied cells. The
        // customer view should not render its unused rows and columns.
        return of({
          gridRows: 20,
          gridCols: 20,
          seats: [
            {
              seatId: 8,
              seatLabel: 'A8',
              gridRow: 4,
              gridCol: 6,
              inventoryItemId: 1,
              sectionName: 'Floor',
              priceCents: 2000,
              color: '#000000',
              status: 'AVAILABLE',
              tag: 'NONE',
            },
            {
              seatId: 9,
              seatLabel: 'B9',
              gridRow: 5,
              gridCol: 15,
              inventoryItemId: 1,
              sectionName: 'Floor',
              priceCents: 2000,
              color: '#000000',
              status: 'AVAILABLE',
              tag: 'NONE',
            },
          ],
        });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
        { provide: ApiService, useValue: { get, post: vi.fn(), url: vi.fn(() => 'mock-image-url') } },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            user: signal({ sub: 'customer', email: 'test@example.com', name: 'Test', groups: [] }),
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
            clear: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const seatGrid = host.querySelector<HTMLElement>('.seat-grid');
    // Both completely empty rows/columns are removed from the customer view.
    expect(seatGrid?.style.gridTemplateColumns).toBe('repeat(2, 1.75rem)');
    expect(seatGrid?.style.gridTemplateRows).toBe('repeat(2, 1.75rem)');
    const renderedSeats = host.querySelectorAll<HTMLElement>('.seat');
    expect(renderedSeats[0]?.style.gridRow).toBe('1');
    expect(renderedSeats[0]?.style.gridColumn).toBe('1');
    expect(renderedSeats[1]?.style.gridRow).toBe('2');
    expect(renderedSeats[1]?.style.gridColumn).toBe('2');
    renderedSeats[0]?.click();
    fixture.detectChanges();
    expect(renderedSeats[0]?.classList.contains('selected')).toBe(true);
    renderedSeats[1]?.click();
    fixture.detectChanges();
    expect(renderedSeats[0]?.classList.contains('selected')).toBe(false);
    expect(renderedSeats[1]?.classList.contains('selected')).toBe(true);
    // The grid must sit inside a container that can scroll instead of
    // visually spilling out of the purchase panel's rounded border.
    expect(seatGrid?.closest('.seat-map')).not.toBeNull();
  });
});

describe('EventDetail inventory summary', () => {
  it('counts a GA zone\'s seats and sales from the zone itself, not the empty per-seat list', async () => {
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
            total_seats: 6,
            available_buyers: 2,
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2000,
          },
        });
      if (path === '/events/172/team-members') return of({ members: [] });
      if (path === '/events/172/inventory')
        // Matches the real inventory service response for a GA zone with a
        // sale: no per-seat rows exist, so seatCount/soldCount come from the
        // zone's own counters rather than `seats`.
        return of({
          zones: [{ inventoryItemId: 1, seatCount: 6, soldCount: 1 }],
          seats: [],
        });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'organiser' } } } },
        { provide: ApiService, useValue: { get, post: vi.fn(), url: vi.fn(() => 'mock-image-url') } },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            user: signal({ sub: 'owner', email: 'owner@example.com', name: 'Owner', groups: [] }),
          },
        },
        { provide: QueueService, useValue: { status: vi.fn(), admissionTokenFor: () => null, clear: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1 zone · 6 seats, 1 sold');
  });
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

describe('EventDetail default seat layout', () => {
  it('uses a filled rectangle for 18 unconfigured seats', () => {
    expect(defaultSeatGridColumns(18)).toBe(6);
  });

  it('keeps non-factor seat totals close to square', () => {
    expect(defaultSeatGridColumns(14)).toBe(4);
  });

  it('naturally orders and colours seats that have no configured coordinates', () => {
    const seats = ['S1', 'S10', 'S2'].map((seatLabel, index) => ({
      seatId: index + 1,
      seatLabel,
      gridRow: null as unknown as number,
      gridCol: null as unknown as number,
      inventoryItemId: 1,
      sectionName: 'General Admission',
      priceCents: 2_000,
      color: null as unknown as string,
      status: 'AVAILABLE' as const,
      tag: 'NONE' as const,
    }));

    const arranged = seatsWithFallbackLayout(seats);
    expect(arranged.map((seat) => seat.seatLabel)).toEqual(['S1', 'S2', 'S10']);
    expect(arranged.map((seat) => seat.color)).toEqual(['#059669', '#059669', '#059669']);
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

});

describe('EventDetail event-team purchases', () => {
  it('renders customer purchase controls for an accepted event helper', async () => {
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
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/customers/me/tickets') return of({ tickets: [] });
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
        {
          provide: ApiService,
          useValue: {
            get,
            put: vi.fn(),
            post: vi.fn(),
            delete: vi.fn(),
            url: vi.fn(() => 'mock-image-url'),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Buy tickets',
      ),
    ).toBe(true);
    expect(get).not.toHaveBeenCalledWith('event', '/helper/shifts');
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
        {
          provide: ApiService,
          useValue: { get, put, post, delete: vi.fn(), url: vi.fn(() => 'mock-image-url') },
        },
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
  async function renderOrganiser(
    startsAt: string,
    status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' = 'PUBLISHED',
    tier: 'TIER1_GA' | 'TIER2_SEATED' = 'TIER1_GA',
    members: readonly Record<string, unknown>[] = [
      {
        membership_id: 1,
        user_sub: 'helper-sub',
        user_email: 'helper@example.com',
        role: 'HELPER',
        invite_status: 'ACCEPTED',
      },
    ],
  ) {
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
            tier,
            status,
            price_cents: 2_000,
          },
        });
      }
      if (path === '/events/172/team-members') return of({ members });
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
        {
          provide: ApiService,
          useValue: { get, put, post, delete: remove, url: vi.fn(() => 'mock-image-url') },
        },
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
    return { fixture, host, button, put, post, remove };
  }

  it('can be opened but not edited, and its team cannot be changed', async () => {
    const { host, button, put, post, remove } = await renderOrganiser('2020-01-01 20:00:00');

    expect(host.textContent).toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('Completed');
    for (const field of [
      'title',
      'description',
      'venue',
      'starts-at',
      'seats',
      'available-buyers',
      'tier',
    ]) {
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

  it('names each team member without a dangling dash when a name or email is missing', async () => {
    const member = (membership_id: number, user_email: string, name?: string) => ({
      membership_id,
      user_sub: `sub-${membership_id}`,
      user_email,
      name,
      role: 'ORGANISER',
      invite_status: 'ACCEPTED',
    });
    const { host } = await renderOrganiser('2099-01-01 20:00:00', 'DRAFT', 'TIER1_GA', [
      member(1, 'both@example.com', 'Both Known'),
      member(2, '', 'Owner Only'),
      member(3, 'email-only@example.com'),
      member(4, ''),
    ]);

    const labels = Array.from(host.querySelectorAll('.member-list strong')).map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Both Known — both@example.com',
      'Owner Only',
      'email-only@example.com',
      'Team member',
    ]);
  });

  it.each([
    [
      404,
      'invited_user_not_found',
      'No OneStage account uses that email. Ask them to sign up first, then invite them again.',
    ],
    [
      409,
      'already_invited_or_member',
      "That person is already on this event's team or has a pending invitation.",
    ],
    [
      400,
      'invited_user_missing_identity',
      "That account isn't fully set up, so it can't be invited yet. Ask them to finish signing up, then invite them again.",
    ],
    [502, 'invitation_failed', 'Unable to send the invitation. Please try again.'],
  ])('says what went wrong when an invitation fails with %i %s', async (status, code, message) => {
    const { fixture, host, button, post } = await renderOrganiser('2099-01-01 20:00:00', 'DRAFT');
    post.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status, error: { error: code } })),
    );
    const email = host.querySelector<HTMLInputElement>('#member-email')!;
    email.value = 'someone@example.com';
    email.dispatchEvent(new Event('input'));
    button('Invite')!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(post).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(message);
  });

  it('says a team member is already gone instead of that the event was not found', async () => {
    const { fixture, host, button, remove } = await renderOrganiser(
      '2099-01-01 20:00:00',
      'DRAFT',
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    remove.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 404, error: { error: 'team_member_not_found' } }),
      ),
    );
    button('Remove')!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      "That person is no longer on this event's team. Refresh the page to see the current team.",
    );
    vi.restoreAllMocks();
  });

  it('stays fully editable while a draft event is still upcoming', async () => {
    const { host, button } = await renderOrganiser('2099-01-01 20:00:00', 'DRAFT');

    expect(host.textContent).not.toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('Draft');
    expect(host.querySelector<HTMLInputElement>('#title')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#member-email')?.disabled).toBe(false);
    for (const label of ['Save changes', 'Delete draft', 'Invite', 'Remove']) {
      expect(button(label)?.disabled, label).toBe(false);
    }
  });

  it('pre-fills the edit form with the Singapore wall-clock start time, not the raw UTC digits', async () => {
    // The event service returns starts_at as the correct UTC instant for 8pm
    // Singapore time on 6 Oct 2099. The edit form's datetime-local input must
    // show "20:00" (8pm SGT), not "12:00" (noon, the raw UTC digits).
    const { host } = await renderOrganiser('2099-10-06T12:00:00.000Z', 'DRAFT');

    expect(host.querySelector<HTMLInputElement>('#starts-at')?.value).toBe('2099-10-06T20:00');
  });

  it("locks the event's own details once published, but leaves team management and lifecycle actions available", async () => {
    const { host, button, put } = await renderOrganiser('2099-01-01 20:00:00', 'PUBLISHED');

    // Still on sale and upcoming — not the "completed" lock.
    expect(host.textContent).not.toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('On sale');
    expect(host.textContent).toContain('already been published');

    expect(host.querySelector<HTMLInputElement>('#title')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#venue')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#available-buyers')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#seats')?.disabled).toBe(true);
    expect(button('Save changes')?.disabled).toBe(true);

    // Team management and the event's own lifecycle actions are unaffected —
    // only its own details (title/venue/etc.) and inventory are locked.
    expect(host.querySelector<HTMLInputElement>('#member-email')?.disabled).toBe(false);
    expect(button('Cancel event')?.disabled).toBe(false);
    expect(button('Invite')?.disabled).toBe(false);
    expect(button('Remove')?.disabled).toBe(false);

    button('Save changes')?.click();
    expect(put).not.toHaveBeenCalled();
  });

  it('shows total seats read-only even on a draft, since the zones in Configure inventory set it', async () => {
    const { host, button } = await renderOrganiser('2099-01-01 20:00:00', 'DRAFT');

    expect(host.querySelector<HTMLInputElement>('#title')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#available-buyers')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#seats')?.disabled).toBe(true);
    expect(host.textContent).toContain('Set by the zones in Configure inventory');
    expect(button('Save changes')?.disabled).toBe(false);
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
        {
          provide: ApiService,
          useValue: { get, put: vi.fn(), post, delete: vi.fn(), url: vi.fn(() => 'mock-image-url') },
        },
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

describe('EventDetail GA ticket tiers', () => {
  async function renderWithZones(zones: readonly {
    inventoryItemId: number;
    name: string;
    priceCents: number;
    color: string;
    remaining: number;
  }[]) {
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
            total_seats: 28,
            available_buyers: 2,
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2000,
          },
        });
      if (path === '/helper/shifts') return of({ events: [] });
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/customers/me/tickets') return of({ tickets: [] });
      if (path === '/events/172/zones') return of({ zones });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const post = vi.fn(() => of({ order: { order_id: 42 } }));

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
        { provide: ApiService, useValue: { get, post, url: vi.fn(() => 'mock-image-url') } },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            user: signal({ sub: 'customer', email: 'test@example.com', name: 'Test', groups: [] }),
          },
        },
        { provide: QueueService, useValue: { status: vi.fn(), admissionTokenFor: () => null, clear: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { host: fixture.nativeElement as HTMLElement, fixture, post };
  }

  // Reproduces the reported bug: a 20-seat "Blue" tier (sold out) and an
  // 8-seat "Red" tier (still available). Buying ticket 21+ must not just
  // 409 because the cheapest/first-created zone is full.
  const blue = { inventoryItemId: 1, name: 'Blue', priceCents: 2000, color: '#2563EB', remaining: 0 };
  const red = { inventoryItemId: 2, name: 'Red', priceCents: 5000, color: '#DC2626', remaining: 8 };

  it('shows no tier picker for a single-zone event, and buys that zone without asking', async () => {
    const { host, post } = await renderWithZones([
      { inventoryItemId: 9, name: 'General Admission', priceCents: 2000, color: '#000', remaining: 28 },
    ]);

    expect(host.querySelector('.zone-picker')).toBeNull();

    const buy = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Buy tickets',
    );
    buy!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));

    expect(post).toHaveBeenCalledExactlyOnceWith(
      'order',
      '/orders',
      expect.objectContaining({ inventoryItemId: 9 }),
    );
  });

  it('auto-selects the cheapest zone with capacity, skipping a sold-out cheaper one', async () => {
    const { host, post } = await renderWithZones([blue, red]);

    const picker = host.querySelector('.zone-picker');
    expect(picker).not.toBeNull();
    const redRadio = Array.from(host.querySelectorAll<HTMLInputElement>('.zone-option input'))
      .find((input) => input.value === '2');
    expect(redRadio?.checked).toBe(true);
    const blueRadio = Array.from(host.querySelectorAll<HTMLInputElement>('.zone-option input'))
      .find((input) => input.value === '1');
    expect(blueRadio?.disabled).toBe(true);

    const buy = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Buy tickets',
    );
    buy!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));

    expect(post).toHaveBeenCalledExactlyOnceWith(
      'order',
      '/orders',
      expect.objectContaining({ inventoryItemId: 2 }),
    );
  });

  it('lets a customer pick a pricier tier even when a cheaper one still has room', async () => {
    const roomyBlue = { ...blue, remaining: 5 };
    const { host, post, fixture } = await renderWithZones([roomyBlue, red]);

    const redOption = Array.from(host.querySelectorAll<HTMLElement>('.zone-option')).find((el) =>
      el.textContent?.includes('Red'),
    );
    redOption!.querySelector('input')!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const buy = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Buy tickets',
    );
    buy!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));

    expect(post).toHaveBeenCalledExactlyOnceWith(
      'order',
      '/orders',
      expect.objectContaining({ inventoryItemId: 2 }),
    );
  });
});
