import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { exhaustMap, firstValueFrom, from, take, takeWhile, timer } from 'rxjs';
import { toDataURL } from 'qrcode';

import { ApiService } from '../core/api';
import { startsTodayOrLater } from '../core/event-dates';
import { QueueService } from '../core/queue';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';
import { ReservationCard } from '../shared/components/reservation-card/reservation-card';
import { ActiveQueuePlaces } from '../layout/components/active-queue-places/active-queue-places';

/** How often, and how many times, to ask whether the confirmation emails have gone out. */
const CONFIRMATION_POLL_MS = 2_000;
const CONFIRMATION_POLL_ATTEMPTS = 20;
/** How long the "confirmation email sent" note stays on screen. */
const EMAIL_TOAST_MS = 3_000;
const paymentProcessingKey = (orderId: number) => `onestage.acceptedPayment.${orderId}`;
const legacyPaymentProcessingKey = (orderId: number) => `onestage.mockPayment.${orderId}`;
const PAYMENT_PROCESSING_MARKER_MAX_AGE_MS = 5 * 60_000;

type ConfirmationEmailStatus = 'SENT' | 'FAILED' | 'PENDING';

interface ConfirmationEmailResponse {
  readonly status: ConfirmationEmailStatus;
}

const toastSeenKey = (orderId: number) => `onestage.confirmationEmailToast.${orderId}`;

/** The note is shown once per order, so reloading the page after a purchase does not repeat it. */
function hasSeenEmailToast(orderId: number): boolean {
  try {
    return sessionStorage.getItem(toastSeenKey(orderId)) === '1';
  } catch {
    return false;
  }
}

function markEmailToastSeen(orderId: number): void {
  try {
    sessionStorage.setItem(toastSeenKey(orderId), '1');
  } catch {
    // Storage is unavailable: the note may show again on a reload, which is harmless.
  }
}

function hasSubmittedPayment(orderId: number, orderCreatedAt?: string): boolean {
  try {
    const key = paymentProcessingKey(orderId);
    sessionStorage.removeItem(legacyPaymentProcessingKey(orderId));
    const startedAt = Number(sessionStorage.getItem(key));
    const age = Date.now() - startedAt;
    const createdAt = Date.parse(orderCreatedAt ?? '');
    const belongsToOrder = !Number.isFinite(createdAt) || startedAt >= createdAt - 1_000;
    if (
      Number.isFinite(startedAt) &&
      startedAt > 0 &&
      age >= 0 &&
      age <= PAYMENT_PROCESSING_MARKER_MAX_AGE_MS &&
      belongsToOrder
    ) {
      return true;
    }
    sessionStorage.removeItem(key);
    return false;
  } catch {
    return false;
  }
}

type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'VOID';

interface Ticket {
  readonly ticket_id: number;
  readonly order_id: number;
  readonly event_id: number;
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly seat_label: string | null;
  readonly qr_token: string;
  readonly status: TicketStatus;
}

interface TicketsResponse {
  readonly tickets: readonly Ticket[];
}

interface PaidOrder {
  readonly order_id: number;
  readonly event_id: number;
  readonly status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  readonly total_amount_cents: number;
  readonly currency: string;
  readonly paid_at: string | null;
  readonly created_at?: string;
  readonly reservation_expires_at?: string;
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly ticket_count: number;
}

interface OrdersResponse {
  readonly orders: readonly PaidOrder[];
}

interface TicketWithQr extends Ticket {
  readonly qrDataUrl: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

/** The signed-in customer's own issued tickets, each with a scannable QR code. */
@Component({
  selector: 'app-my-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, WorkspaceShell, ActiveQueuePlaces, ReservationCard],
  templateUrl: './my-events.html',
  styleUrl: './my-events.css',
})
export class MyEvents {
  private readonly api = inject(ApiService);
  private readonly queue = inject(QueueService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private requestRunning = false;
  private readonly pendingOrderId =
    Number(this.route.snapshot.queryParamMap.get('orderId')) || null;
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly tickets = signal<readonly TicketWithQr[]>([]);
  protected readonly orders = signal<readonly PaidOrder[]>([]);
  protected readonly now = signal(Date.now());
  protected readonly cancellingOrderIds = signal<ReadonlySet<number>>(new Set());
  protected readonly reservationError = signal('');
  protected readonly purchaseDates = computed(
    () => new Map(this.orders().map((order) => [Number(order.order_id), order.paid_at])),
  );
  /** Orders for events from today on: only these can still be paid for or cancelled. */
  private readonly currentOrders = computed(() =>
    this.orders().filter((order) => startsTodayOrLater(order.starts_at, new Date())),
  );
  protected readonly unpaidOrders = computed(() =>
    this.currentOrders().filter(
      (order) =>
        order.status === 'PENDING' && !hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly processingOrders = computed(() =>
    this.currentOrders().filter(
      (order) =>
        order.status === 'PENDING' && hasSubmittedPayment(order.order_id, order.created_at),
    ),
  );
  protected readonly pendingOrders = computed(() => {
    const issuedOrderIds = new Set(this.tickets().map((ticket) => ticket.order_id));
    return this.orders().filter(
      (order) => order.status === 'PAID' && !issuedOrderIds.has(order.order_id),
    );
  });
  /** The header search, bound from the `q` query parameter. */
  readonly q = input<string>();
  protected readonly searchQuery = computed(() => this.q()?.trim() ?? '');
  /**
   * Events from earlier days are completed and hidden unless asked for. Today's
   * stay listed even once started, so a latecomer can still show their ticket.
   */
  protected readonly includeCompleted = signal(false);
  // The unfiltered lists above still drive polling and expiry; only what is
  // shown narrows to the checkbox and the search.
  protected readonly shownUnpaidOrders = computed(() => this.shown(this.unpaidOrders()));
  protected readonly shownProcessingOrders = computed(() => this.shown(this.processingOrders()));
  protected readonly shownPendingOrders = computed(() => this.shown(this.pendingOrders()));
  protected readonly shownTickets = computed(() => this.shown(this.tickets()));
  /** Whether anything is being left out only because its event is completed. */
  protected readonly hidesCompleted = computed(
    () =>
      !this.includeCompleted() &&
      [...this.tickets(), ...this.pendingOrders()].some(
        (item) => !startsTodayOrLater(item.starts_at, new Date()),
      ),
  );
  protected readonly noSearchMatches = computed(
    () =>
      !!this.searchQuery() &&
      [
        this.shownUnpaidOrders(),
        this.shownProcessingOrders(),
        this.shownPendingOrders(),
        this.shownTickets(),
      ].every((list) => list.length === 0),
  );
  protected readonly waitingForTicket = computed(
    () =>
      this.pendingOrderId !== null &&
      this.orders().some(
        (order) => order.order_id === this.pendingOrderId && order.status === 'PAID',
      ) &&
      !this.tickets().some((ticket) => ticket.order_id === this.pendingOrderId),
  );

  protected readonly emailToast = signal(false);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.load();
    timer(5_000, 5_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.waitingForTicket() || this.processingOrders().length > 0) void this.load(true);
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
    if (this.pendingOrderId !== null) this.watchConfirmationEmail(this.pendingOrderId);
    this.destroyRef.onDestroy(() => clearTimeout(this.toastTimer));
  }

  /**
   * Right after a purchase the emails go out a moment later, from the backend.
   * Ask until they have, then say so once; give up quietly if they do not.
   */
  private watchConfirmationEmail(orderId: number): void {
    if (hasSeenEmailToast(orderId)) return;
    timer(0, CONFIRMATION_POLL_MS)
      .pipe(
        take(CONFIRMATION_POLL_ATTEMPTS),
        exhaustMap(() => from(this.confirmationEmailStatus(orderId))),
        takeWhile((status) => status === 'PENDING', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => {
        if (status === 'SENT') this.showEmailToast(orderId);
      });
  }

  private async confirmationEmailStatus(
    orderId: number,
  ): Promise<ConfirmationEmailStatus | 'UNAVAILABLE'> {
    try {
      const result = await firstValueFrom(
        this.api.get<ConfirmationEmailResponse>(
          'ticket',
          `/customers/me/orders/${orderId}/confirmation`,
        ),
      );
      return result.status;
    } catch (error) {
      // Not this customer's order (or not an order): there is nothing to wait for.
      // Any other failure is treated as temporary and asked again.
      const settled = error instanceof HttpErrorResponse && [404, 422].includes(error.status);
      return settled ? 'UNAVAILABLE' : 'PENDING';
    }
  }

  private showEmailToast(orderId: number): void {
    markEmailToastSeen(orderId);
    this.emailToast.set(true);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.emailToast.set(false), EMAIL_TOAST_MS);
  }

  protected async load(silent = false): Promise<void> {
    if (this.requestRunning) return;
    this.requestRunning = true;
    if (!silent) this.status.set('loading');
    try {
      const [result, orderResult] = await Promise.all([
        firstValueFrom(this.api.get<TicketsResponse>('ticket', '/customers/me/tickets')),
        firstValueFrom(this.api.get<OrdersResponse>('order', '/customers/me/orders')),
      ]);
      for (const order of orderResult.orders) {
        if (order.status !== 'PENDING') {
          try {
            sessionStorage.removeItem(paymentProcessingKey(order.order_id));
          } catch {
            // Storage is optional; order state still comes from the backend.
          }
        }
      }
      // Everything is kept; completed events are hidden from view, not dropped.
      const withQr = await Promise.all(
        result.tickets.map(async (ticket) => ({
          ...ticket,
          qrDataUrl: await toDataURL(ticket.qr_token, {
            width: 360,
            margin: 4,
            errorCorrectionLevel: 'M',
          }),
        })),
      );
      this.tickets.set(withQr);
      this.orders.set(orderResult.orders);
      this.status.set('ready');
    } catch {
      if (!silent || this.tickets().length === 0) this.status.set('error');
    } finally {
      this.requestRunning = false;
    }
  }

  /**
   * The items to list: completed events only when included, then those whose
   * event title or venue contains the search, ignoring case.
   */
  private shown<
    T extends { readonly event_title: string; readonly venue?: string; readonly starts_at: string },
  >(items: readonly T[]): readonly T[] {
    const today = new Date();
    const term = this.searchQuery().toLowerCase();
    return items.filter(
      (item) =>
        (this.includeCompleted() || startsTodayOrLater(item.starts_at, today)) &&
        (!term ||
          [item.event_title, item.venue].some((field) => field?.toLowerCase().includes(term))),
    );
  }

  protected statusLabel(status: TicketStatus): string {
    return status === 'CHECKED_IN' ? 'Checked in' : status === 'VOID' ? 'Void' : 'Ready to scan';
  }

  protected reservationTimeLabel(order: PaidOrder): string {
    const seconds = this.reservationSeconds(order);
    if (seconds === null) return 'soon';
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private reservationSeconds(order: PaidOrder): number | null {
    const expiresAt = Date.parse(order.reservation_expires_at ?? '');
    if (!Number.isFinite(expiresAt)) return null;
    return Math.max(0, Math.ceil((expiresAt - this.now()) / 1_000));
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
        await this.load(true);
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

  protected money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(cents / 100);
  }
}
