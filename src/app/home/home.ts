import { DatePipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, firstValueFrom, forkJoin, map, of, timer } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventCategory, FeaturedSlide, Venue } from '../core/catalog';
import { hasSubmittedPayment } from '../core/payment-processing';
import { QueueService } from '../core/queue';
import { startsTodayOrLater } from '../core/event-dates';
import { formatEventDate, formatEventTime } from '../core/event-time';
import { EventStatus } from '../events/event.models';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';
import { ReservationCard } from '../shared/components/reservation-card/reservation-card';
import { Carousel } from './components/carousel/carousel';

type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'VOID';

/** One row of `GET /customers/me/tickets` — see `my-events.ts` for the full shape. */
interface UpcomingTicket {
  readonly ticket_id: number;
  readonly order_id: number;
  readonly event_id: number;
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly seat_label: string | null;
  readonly status: TicketStatus;
}

interface TicketsResponse {
  readonly tickets: readonly UpcomingTicket[];
}

interface PaidOrder {
  readonly order_id: number;
  readonly event_id: number;
  readonly status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly ticket_count: number;
  readonly created_at?: string;
  readonly reservation_expires_at?: string;
}

interface OrdersResponse {
  readonly orders: readonly PaidOrder[];
}

interface UpcomingPurchase {
  readonly key: string;
  readonly eventTitle: string;
  readonly venue: string;
  readonly startsAt: string;
  readonly detail: string;
  readonly state: string;
}

type PurchaseLoadStatus = 'loading' | 'ready' | 'error';

interface VenueResponse {
  readonly venues: readonly Venue[];
}

interface EventApiRecord {
  readonly event_id: number;
  readonly title?: string;
  readonly event_name?: string;
  readonly venue: string;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
  readonly tier?: 'TIER1_GA' | 'TIER2_SEATED';
  readonly event_type?: 'TIER1_GA' | 'TIER2_SEATED';
  readonly status?: EventStatus;
}

interface EventResponse {
  readonly events: readonly EventApiRecord[];
}

const VENUE_IMAGES = [
  'images/venue-auditorium-v2.jpg',
  'images/venue-sports-v2.jpg',
  'images/venue-club-v2.jpg',
  'images/venue-openair.jpg',
  'images/venue-stadium.jpg',
  'images/venue-arena.jpg',
] as const;

/** Landing page: featured carousel and venue grid. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReservationCard, Carousel, DatePipe, NgOptimizedImage, RouterLink, WorkspaceShell],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly api = inject(ApiService);
  private readonly queue = inject(QueueService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly tickets = signal<readonly UpcomingTicket[]>([]);
  protected readonly orders = signal<readonly PaidOrder[]>([]);
  protected readonly purchaseStatus = signal<PurchaseLoadStatus>('loading');
  protected readonly now = signal(Date.now());
  protected readonly cancellingOrderIds = signal<ReadonlySet<number>>(new Set());
  protected readonly reservationError = signal('');
  protected readonly unpaidOrders = computed(() =>
    this.orders().filter(
      (order) =>
        order.status === 'PENDING' && !hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly processingOrders = computed(() =>
    this.orders().filter(
      (order) =>
        order.status === 'PENDING' && hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly upcomingPurchases = computed<readonly UpcomingPurchase[]>(() => {
    const tickets = this.tickets();
    const issuedOrderIds = new Set(tickets.map((ticket) => ticket.order_id));
    const ticketRows: UpcomingPurchase[] = tickets.map((ticket) => ({
      key: `ticket-${ticket.ticket_id}`,
      eventTitle: ticket.event_title,
      venue: ticket.venue,
      startsAt: ticket.starts_at,
      detail: ticket.seat_label ?? 'General admission',
      state: ticket.status === 'CHECKED_IN' ? 'Checked in' : 'Ready to scan',
    }));
    const paidOrderRows: UpcomingPurchase[] = this.orders()
      .filter((order) => order.status === 'PAID' && !issuedOrderIds.has(order.order_id))
      .map((order) => ({
        key: `order-${order.order_id}`,
        eventTitle: order.event_title,
        venue: order.venue,
        startsAt: order.starts_at,
        detail: `${Number(order.ticket_count)} ticket${Number(order.ticket_count) === 1 ? '' : 's'}`,
        state: 'Payment received · issuing ticket',
      }));

    // Only events happening today or later, and before the top-5 cut so that past
    // tickets do not take up the slots.
    const now = new Date();
    return [...ticketRows, ...paidOrderRows]
      .filter((purchase) => startsTodayOrLater(purchase.startsAt, now))
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .slice(0, 5);
  });

  /** First part of the email, which is the closest thing to a name we hold. */
  protected readonly firstName = computed(() => this.auth.user()?.email.split('@')[0] ?? '');

  protected readonly venues = signal<readonly Venue[]>([]);
  protected readonly featuredVenues = computed(() => this.venues().slice(0, 6));
  protected readonly featuredSlides = signal<readonly FeaturedSlide[]>([]);

  protected venueImage(index: number): string {
    return VENUE_IMAGES[index % VENUE_IMAGES.length];
  }

  constructor() {
    this.api.get<EventResponse>('event', '/events').subscribe({
      next: (result) => this.featuredSlides.set(featuredSlidesFrom(result.events, Date.now())),
      error: () => this.featuredSlides.set([]),
    });
    this.api.get<VenueResponse>('event', '/venues').subscribe({
      next: (result) => this.venues.set(result.venues),
      error: () => this.venues.set([]),
    });
    effect(() => {
      if (!this.auth.isAuthenticated()) {
        this.tickets.set([]);
        this.orders.set([]);
        this.purchaseStatus.set('loading');
        return;
      }
      this.purchaseStatus.set('loading');
      forkJoin({
        tickets: this.api.get<TicketsResponse>('ticket', '/customers/me/tickets').pipe(
          map((result) => ({ ok: true as const, result })),
          catchError(() => of({ ok: false as const, result: { tickets: [] } })),
        ),
        orders: this.api.get<OrdersResponse>('order', '/customers/me/orders').pipe(
          map((result) => ({ ok: true as const, result })),
          catchError(() => of({ ok: false as const, result: { orders: [] } })),
        ),
      }).subscribe(({ tickets, orders }) => {
        this.tickets.set(tickets.result.tickets);
        this.orders.set(orders.result.orders);
        this.purchaseStatus.set(tickets.ok || orders.ok ? 'ready' : 'error');
      });
    });
    timer(0, 1_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
        for (const order of this.unpaidOrders()) {
          if (this.reservationSeconds(order) === 0 && !this.isCancelling(order.order_id)) {
            void this.cancelReservation(order, true);
          }
        }
      });
  }

  protected reservationTimeLabel(order: PaidOrder): string {
    const seconds = this.reservationSeconds(order);
    if (seconds === null) return 'soon';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected isCancelling(orderId: number): boolean {
    return this.cancellingOrderIds().has(orderId);
  }

  protected async cancelReservation(order: PaidOrder, expired = false): Promise<void> {
    if (this.isCancelling(order.order_id)) return;
    if (hasSubmittedPayment(order.order_id, order.created_at)) {
      this.reservationError.set(
        'Payment has already been submitted, so this order can no longer be cancelled.',
      );
      return;
    }
    this.cancellingOrderIds.update((ids) => new Set(ids).add(order.order_id));
    this.reservationError.set('');
    try {
      await firstValueFrom(
        this.api.post<void>(
          'order',
          `/orders/${order.order_id}/cancel`,
          expired ? { reason: 'expired' } : {},
        ),
      );
      this.orders.update((orders) => orders.filter((item) => item.order_id !== order.order_id));
      this.queue.clear(order.event_id);
    } catch {
      if (expired) {
        this.orders.update((orders) => orders.filter((item) => item.order_id !== order.order_id));
      } else {
        this.reservationError.set('Unable to cancel this reservation. Please try again.');
      }
    } finally {
      this.cancellingOrderIds.update((ids) => {
        const next = new Set(ids);
        next.delete(order.order_id);
        return next;
      });
    }
  }

  private reservationSeconds(order: PaidOrder): number | null {
    const expiresAt = Date.parse(order.reservation_expires_at ?? '');
    if (!Number.isFinite(expiresAt)) return null;
    return Math.max(0, Math.ceil((expiresAt - this.now()) / 1_000));
  }

  protected readonly assurances = [
    {
      title: 'Verified tickets',
      detail: 'Every listing is issued and validated by the venue, never resold twice.',
    },
    {
      title: 'Fair queue',
      detail: 'A fair queue for every on-sale, so bots do not get ahead of you.',
    },
    {
      title: 'Instant delivery',
      detail: 'Mobile tickets land in your account the moment payment clears.',
    },
  ] as const;
}

/**
 * The next three events that have not started yet, soonest first. `/events` lists past
 * events too, oldest first, so taking its first rows would feature events already over.
 * An event with no readable start time is left out: a hero slide needs a date to show.
 */
function featuredSlidesFrom(events: readonly EventApiRecord[], now: number): FeaturedSlide[] {
  return events
    .map((event) => ({ event, startsAt: event.starts_at ?? event.event_start_datetime ?? '' }))
    .filter(({ event, startsAt }) => event.status !== 'CANCELLED' && Date.parse(startsAt) >= now)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, 3)
    .map(({ event, startsAt }) => {
      const title = event.title ?? event.event_name ?? '';
      return {
        id: event.event_id,
        category: categoryFor(event, title),
        title,
        date: `${formatEventDate(startsAt)} · ${formatEventTime(startsAt)}`,
        image: 'images/hero-concert.jpg',
        alt: `${title} artwork`,
      };
    });
}

function categoryFor(event: EventApiRecord, title: string): EventCategory {
  const text = `${title} ${event.venue}`.toLowerCase();
  const tier = event.tier ?? event.event_type;
  if (/cup|derby|stadium|match|football/.test(text)) return 'Sports';
  if (tier === 'TIER2_SEATED' || /theatre|comedy|improv/.test(text)) return 'Theatre';
  return 'Concerts';
}
