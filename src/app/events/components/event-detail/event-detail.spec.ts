import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../../core/api';
import { AuthService } from '../../../core/auth';
import { QueueService } from '../../../core/queue';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import {
  buyerCapacity,
  defaultSeatGridColumns,
  EventDetail,
  purchaseErrorMessage,
  seatsWithFallbackLayout,
} from './event-detail';

/** Both tiers sell through the waiting room; this customer has already been admitted. */
const admittedQueue = () => ({
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
});

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
              {
                inventoryItemId: 5,
                name: 'General Admission',
                priceCents: 2000,
                color: '#000',
                remaining: 10,
              },
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
        admissionToken: 'test-admission',
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
        {
          provide: ApiService,
          useValue: { get, post: vi.fn(), url: vi.fn(() => 'mock-image-url') },
        },
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
    // A seat map needs room to lay out without scrolling inside its own card.
    expect(host.querySelector('.purchase')?.classList.contains('purchase--wide')).toBe(true);
    // The buyer has no other way to tell which way the venue faces, so the
    // map always shows a stage marker above the seats, not below.
    const seatMap = seatGrid?.closest('.seat-map');
    const stage = seatMap?.querySelector('.stage-indicator');
    expect(stage?.textContent?.trim()).toBe('Stage');
    const position = stage!.compareDocumentPosition(seatGrid!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('EventDetail inventory summary', () => {
  it("counts a GA zone's seats and sales from the zone itself, not the empty per-seat list", async () => {
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
        {
          provide: ApiService,
          useValue: { get, post: vi.fn(), url: vi.fn(() => 'mock-image-url') },
        },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            user: signal({ sub: 'owner', email: 'owner@example.com', name: 'Owner', groups: [] }),
          },
        },
        admittedQueue(),
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
        admittedQueue(),
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
    const { fixture, host, button, remove } = await renderOrganiser('2099-01-01 20:00:00', 'DRAFT');
    vi.spyOn(TestBed.inject(ConfirmDialogService), 'ask').mockResolvedValue(true);
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

  it('shows the UTC start time in local time and saves an edited time back in UTC', async () => {
    const startsAt = '2099-01-01T12:00:00.000Z';
    const { fixture, host, button, put } = await renderOrganiser(startsAt, 'DRAFT');
    const input = host.querySelector<HTMLInputElement>('#starts-at')!;

    expect(new Date(input.value).toISOString()).toBe(startsAt);

    input.value = '2099-01-02T19:30';
    input.dispatchEvent(new Event('input'));
    button('Save changes')!.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(put).toHaveBeenCalledWith(
      'event',
      '/events/172',
      expect.objectContaining({ startsAt: new Date(2099, 0, 2, 19, 30).toISOString() }),
    );
  });

  it('keeps only available buyers editable after publishing', async () => {
    const { fixture, host, button, put } = await renderOrganiser(
      '2099-01-01 20:00:00',
      'PUBLISHED',
    );

    // Still on sale and upcoming — not the "completed" lock.
    expect(host.textContent).not.toContain('This event has completed');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('On sale');
    expect(host.textContent).toContain('already been published');

    expect(host.querySelector<HTMLInputElement>('#title')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#venue')?.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#available-buyers')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#seats')?.disabled).toBe(true);
    expect(button('Save available buyers')?.disabled).toBe(false);

    // Team management and the event's own lifecycle actions are unaffected —
    // only its own details (title/venue/etc.) and inventory are locked.
    expect(host.querySelector<HTMLInputElement>('#member-email')?.disabled).toBe(false);
    expect(button('Cancel event')?.disabled).toBe(false);
    expect(button('Invite')?.disabled).toBe(false);
    expect(button('Remove')?.disabled).toBe(false);

    const availableBuyers = host.querySelector<HTMLInputElement>('#available-buyers')!;
    availableBuyers.value = '4';
    availableBuyers.dispatchEvent(new Event('input'));
    button('Save available buyers')?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(put).toHaveBeenCalledWith('event', '/events/172/available-buyers', {
      availableBuyers: 4,
    });
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
    admitted?: boolean;
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
      if (path === '/events/172/queue/me') {
        return options.admitted
          ? of({ status: 'ADMITTED', admissionToken: 'test-admission', tokenExpiresAt: '2099-01-01T20:00:00Z' })
          : throwError(() => new HttpErrorResponse({ status: 404 }));
      }
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
          useValue: {
            get,
            put: vi.fn(),
            post,
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

  it('sends a general-admission customer through the waiting room before they can buy', async () => {
    const { hasControl } = await renderCustomer({ startsAt: '2099-01-01 20:00:00' });

    expect(hasControl('Join waiting room')).toBe(true);
    expect(hasControl('Buy tickets')).toBe(false);
  });

  it('still lets customers buy while the event is upcoming, once admitted', async () => {
    const { host, hasControl } = await renderCustomer({ startsAt: '2099-01-01 20:00:00', admitted: true });

    expect(hasControl('Buy tickets')).toBe(true);
    expect(host.textContent).not.toContain('This event has already taken place');
    expect(host.querySelector('.event-facts .status')?.textContent?.trim()).toBe('On sale');
  });

  it('sends a ticket holder who wants more straight into the waiting room', async () => {
    const { host } = await renderCustomer({ startsAt: '2099-01-01 20:00:00', ownedTickets: 2 });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const buyMore = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Buy more tickets',
    );
    buyMore!.click();

    expect(navigate).toHaveBeenCalledWith(['/events', '172', 'queue']);
  });

  it('lets an already-admitted ticket holder buy more without queueing again', async () => {
    const { host, hasControl } = await renderCustomer({
      startsAt: '2099-01-01 20:00:00',
      ownedTickets: 2,
      admitted: true,
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Buy more tickets')
      ?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    TestBed.inject(ApplicationRef).tick();

    expect(navigate).not.toHaveBeenCalled();
    expect(hasControl('Buy tickets')).toBe(true);
  });

  it('explains the server refusing an order for a completed event', () => {
    const error = new HttpErrorResponse({ status: 409, error: { error: 'event_completed' } });

    expect(purchaseErrorMessage(error)).toContain('already taken place');
  });
});

describe('EventDetail GA ticket tiers', () => {
  async function renderWithZones(
    zones: readonly {
      inventoryItemId: number;
      name: string;
      priceCents: number;
      color: string;
      remaining: number;
      gridRow?: number;
      gridCol?: number;
      gridRowSpan?: number;
      gridColSpan?: number;
    }[],
    gridDims?: { gridRows: number; gridCols: number },
  ) {
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
      if (path === '/events/172/zones') return of({ ...gridDims, zones });
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
        admittedQueue(),
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
  const blue = {
    inventoryItemId: 1,
    name: 'Blue',
    priceCents: 2000,
    color: '#2563EB',
    remaining: 0,
  };
  const red = { inventoryItemId: 2, name: 'Red', priceCents: 5000, color: '#DC2626', remaining: 8 };

  it('shows no tier picker for a single-zone event, and buys that zone without asking', async () => {
    const { host, post } = await renderWithZones([
      {
        inventoryItemId: 9,
        name: 'General Admission',
        priceCents: 2000,
        color: '#000',
        remaining: 28,
      },
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
    const redRadio = Array.from(host.querySelectorAll<HTMLInputElement>('.zone-option input')).find(
      (input) => input.value === '2',
    );
    expect(redRadio?.checked).toBe(true);
    const blueRadio = Array.from(
      host.querySelectorAll<HTMLInputElement>('.zone-option input'),
    ).find((input) => input.value === '1');
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

  it('lists ticket types from most to least expensive', async () => {
    const roomyBlue = { ...blue, remaining: 5 };
    const { host } = await renderWithZones([roomyBlue, red]);

    const names = Array.from(host.querySelectorAll<HTMLElement>('.zone-option .zone-name')).map(
      (el) => el.textContent?.trim(),
    );
    expect(names).toEqual(['Red', 'Blue']);
  });

  // The reported gap: a GA buyer saw only a flat list of zone names/prices,
  // with no sense of where each zone actually sits — unlike TIER2_SEATED,
  // which shows the organiser's painted layout. The fix reuses that same
  // grid, just with each zone rendered as one read-only coloured block
  // (no seat to pick) instead of individually clickable seats.
  it("shows the organiser's zone layout as a read-only grid, like reserved seating but without pickable seats", async () => {
    const floor = {
      inventoryItemId: 1,
      name: 'Floor',
      priceCents: 2000,
      color: '#2563EB',
      remaining: 10,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 2,
      gridColSpan: 3,
    };
    const balcony = {
      inventoryItemId: 2,
      name: 'Balcony',
      priceCents: 5000,
      color: '#DC2626',
      remaining: 5,
      gridRow: 2,
      gridCol: 0,
      gridRowSpan: 1,
      gridColSpan: 4,
    };
    const { host } = await renderWithZones([floor, balcony], { gridRows: 6, gridCols: 8 });

    const zoneMap = host.querySelector('.zone-map');
    expect(zoneMap).not.toBeNull();

    const blocks = Array.from(host.querySelectorAll<HTMLElement>('.zone-block'));
    expect(blocks.length).toBe(2);

    const floorBlock = blocks.find((block) => block.textContent?.includes('Floor'));
    expect(floorBlock?.style.gridRow).toBe('1 / span 2');
    expect(floorBlock?.style.gridColumn).toBe('1 / span 3');
    expect(floorBlock?.style.backgroundColor).toBe('rgb(37, 99, 235)'); // #2563EB

    const balconyBlock = blocks.find((block) => block.textContent?.includes('Balcony'));
    expect(balconyBlock?.style.gridRow).toBe('3 / span 1');
    expect(balconyBlock?.style.gridColumn).toBe('1 / span 4');

    // Display only: no button, no click-to-select — the radio list above
    // remains the only way to choose a tier.
    expect(floorBlock?.tagName).toBe('DIV');

    // The buyer has no other way to tell which way the venue faces, so the
    // map always shows a stage marker above the blocks, not below.
    const zoneGrid = host.querySelector('.zone-grid');
    const stage = zoneMap?.querySelector('.stage-indicator');
    expect(stage?.textContent?.trim()).toBe('Stage');
    const position = stage!.compareDocumentPosition(zoneGrid!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no zone map when the API has no grid layout for this event', async () => {
    const { host } = await renderWithZones([
      { inventoryItemId: 9, name: 'General Admission', priceCents: 2000, color: '#000', remaining: 28 },
    ]);

    expect(host.querySelector('.zone-map')).toBeNull();
    // No map to show means no need for the wider card either.
    expect(host.querySelector('.purchase')?.classList.contains('purchase--wide')).toBe(false);
  });

  it('widens the purchase card so the zone map does not need to scroll', async () => {
    const floor = {
      inventoryItemId: 1,
      name: 'Floor',
      priceCents: 2000,
      color: '#2563EB',
      remaining: 10,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 2,
      gridColSpan: 3,
    };
    const { host } = await renderWithZones([floor], { gridRows: 2, gridCols: 3 });

    expect(host.querySelector('.purchase')?.classList.contains('purchase--wide')).toBe(true);
  });

  it('scales a high-capacity GA layout into a bounded customer map', async () => {
    const section = {
      inventoryItemId: 1,
      name: 'Section A1',
      priceCents: 2000,
      color: '#2563EB',
      remaining: 20_449,
      gridRow: 0,
      gridCol: 0,
      gridRowSpan: 143,
      gridColSpan: 143,
    };
    const { host } = await renderWithZones([section], { gridRows: 1000, gridCols: 1000 });

    const grid = host.querySelector<HTMLElement>('.zone-grid');
    expect(grid).not.toBeNull();
    expect(grid?.style.gridTemplateRows).toContain('repeat(1000');
    expect(grid?.style.gridTemplateColumns).toContain('repeat(1000');

    const cellRem = Number(/repeat\(1000, ([\d.]+)rem\)/.exec(grid?.style.gridTemplateRows ?? '')?.[1]);
    const gapRem = Number(grid?.style.gap.replace('rem', ''));
    const renderedHeightRem = 1000 * cellRem + 999 * gapRem;
    expect(cellRem).toBeLessThan(0.05);
    expect(renderedHeightRem).toBeLessThanOrEqual(32.001);
  });
});

describe('EventDetail stage pieces', () => {
  async function renderWithStage(stagePieces?: readonly { gridRow: number; gridCol: number; gridRowSpan: number; gridColSpan: number }[]) {
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
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2000,
          },
        });
      if (path === '/helper/shifts') return of({ events: [] });
      if (path === '/customers/me/orders') return of({ orders: [] });
      if (path === '/customers/me/tickets') return of({ tickets: [] });
      if (path === '/events/172/zones')
        return of({
          gridRows: 5,
          gridCols: 4,
          zones: [{ inventoryItemId: 1, name: 'Floor', priceCents: 2000, color: '#2563EB', remaining: 10, gridRow: 0, gridCol: 0, gridRowSpan: 4, gridColSpan: 4 }],
          ...(stagePieces !== undefined ? { stagePieces } : {}),
        });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { workspace: 'customer' } } } },
        { provide: ApiService, useValue: { get, post: vi.fn(() => of({ order: { order_id: 42 } })), url: vi.fn(() => 'mock-image-url') } },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => true,
            user: signal({ sub: 'customer', email: 'test@example.com', name: 'Test', groups: [] }),
          },
        },
        admittedQueue(),
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows merged stage geometry on the zone map when the API returns stage pieces', async () => {
    const host = await renderWithStage([{ gridRow: 4, gridCol: 0, gridRowSpan: 1, gridColSpan: 4 }]);
    const zoneMap = host.querySelector('.zone-map');

    const stageCells = zoneMap?.querySelectorAll<HTMLElement>('.stage-cell');
    expect(stageCells?.length).toBe(4);
    expect(stageCells?.[0]?.style.top).toBe('8.5rem');
    expect(stageCells?.[0]?.style.left).toBe('0rem');
    expect(stageCells?.[0]?.style.width).toBe('2.125rem');
    expect(stageCells?.[3]?.style.left).toBe('6.375rem');
    expect(stageCells?.[3]?.style.width).toBe('1.75rem');
    expect(zoneMap?.querySelector('.stage-label')?.textContent?.trim()).toBe('Stage');

    // Static fallback bar should be replaced
    expect(zoneMap?.querySelector('.stage-indicator')).toBeNull();
  });

  it('falls back to the static stage bar when no stage pieces are configured', async () => {
    const host = await renderWithStage([]);
    const zoneMap = host.querySelector('.zone-map');

    expect(zoneMap?.querySelector('.stage-indicator')).not.toBeNull();
    expect(zoneMap?.querySelectorAll('.stage-cell').length).toBe(0);
  });
});
