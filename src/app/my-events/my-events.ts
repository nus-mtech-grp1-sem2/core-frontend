import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, timer } from 'rxjs';
import { toDataURL } from 'qrcode';

import { ApiService } from '../core/api';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

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
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly ticket_count: number;
}

interface OrdersResponse {
  readonly orders: readonly PaidOrder[];
}

interface TeamEventsResponse {
  readonly events: readonly { readonly event_id: number }[];
}

interface TicketWithQr extends Ticket {
  readonly qrDataUrl: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

/** The signed-in customer's own issued tickets, each with a scannable QR code. */
@Component({
  selector: 'app-my-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="customer">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Your account</p>
          <h1>My events</h1>
          <p class="lead">Tickets issued to your account, ready to scan at the door.</p>
        </div>
      </section>

      <section class="shell body">
        @if (waitingForTicket()) {
          <div class="issuance" role="status">
            <strong>Payment successful.</strong> Your purchase is shown below. The QR ticket will
            appear when issuance completes.
          </div>
        }
        @switch (status()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading your tickets…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load your tickets.
              <button type="button" class="retry" (click)="load()">Try again</button>
            </p>
          }
          @case ('ready') {
            @if (pendingOrders().length > 0) {
              <section class="pending-list" aria-label="Paid orders awaiting tickets">
                @for (order of pendingOrders(); track order.order_id) {
                  <article class="ticket-card pending-card">
                    <div class="ticket-placeholder" aria-hidden="true">✓</div>
                    <div class="details">
                      <h2>
                        <a [routerLink]="['/events', order.event_id]">{{ order.event_title }}</a>
                      </h2>
                      <p>{{ order.venue }} · {{ order.starts_at | date: 'EEE d MMM y, h:mm a' }}</p>
                      <dl>
                        <div>
                          <dt>Tickets</dt>
                          <dd>{{ order.ticket_count }}</dd>
                        </div>
                        <div>
                          <dt>Paid</dt>
                          <dd>{{ money(order.total_amount_cents, order.currency) }}</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>Payment received · issuing ticket</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                }
              </section>
            }
            <ul class="ticket-list">
              @for (ticket of tickets(); track ticket.ticket_id) {
                <li>
                  <article class="ticket-card">
                    <img
                      class="qr"
                      [src]="ticket.qrDataUrl"
                      [alt]="'QR code for ticket ' + ticket.ticket_id"
                    />
                    <div class="details">
                      <h2>
                        <a [routerLink]="['/events', ticket.event_id]">{{ ticket.event_title }}</a>
                      </h2>
                      <p>
                        {{ ticket.venue }} · {{ ticket.starts_at | date: 'EEE d MMM y, h:mm a' }}
                      </p>
                      <dl>
                        @if (ticket.seat_label) {
                          <div>
                            <dt>Seat</dt>
                            <dd>{{ ticket.seat_label }}</dd>
                          </div>
                        }
                        <div>
                          <dt>Status</dt>
                          <dd>{{ statusLabel(ticket.status) }}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                </li>
              } @empty {
                @if (pendingOrders().length === 0) {
                  <li class="empty">
                    <h2>No tickets yet</h2>
                    <p>Tickets you buy will show up here with a scannable QR code.</p>
                    <a class="btn btn-primary" routerLink="/events">Browse events</a>
                  </li>
                }
              }
            </ul>
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
    }
    .issuance {
      margin-bottom: 1rem;
      padding: 0.875rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--success-bg);
      color: var(--success-fg);
    }
    .ticket-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 1rem;
    }
    .pending-list {
      display: grid;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .ticket-card {
      display: grid;
      grid-template-columns: 6.5rem 1fr;
      gap: 1.25rem;
      align-items: center;
      padding: 1.25rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg);
    }
    .qr {
      width: 6.5rem;
      height: 6.5rem;
      border-radius: var(--radius);
    }
    .ticket-placeholder {
      display: grid;
      place-items: center;
      width: 6.5rem;
      height: 6.5rem;
      border-radius: var(--radius);
      background: var(--success-bg);
      color: var(--success-fg);
      font-size: 2rem;
      font-weight: 700;
    }
    h2 {
      margin: 0;
      font-size: 1.125rem;
    }
    h2 a {
      color: var(--text);
      text-decoration: none;
    }
    h2 a:hover {
      color: var(--brand-600);
      text-decoration: underline;
    }
    .details > p {
      margin: 0.25rem 0 0.875rem;
      color: var(--text-muted);
    }
    dl {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 2rem;
      margin: 0;
    }
    dl div {
      display: grid;
      gap: 0.125rem;
    }
    dt {
      color: var(--text-muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    dd {
      margin: 0;
      font-size: 0.875rem;
    }
    .empty {
      padding: 2rem;
      text-align: center;
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-lg);
    }
    .empty p {
      color: var(--text-muted);
    }
    @media (max-width: 720px) {
      .ticket-card {
        grid-template-columns: 1fr;
        justify-items: start;
      }
    }
  `,
})
export class MyEvents {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private requestRunning = false;
  private readonly pendingOrderId =
    Number(this.route.snapshot.queryParamMap.get('orderId')) || null;
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly tickets = signal<readonly TicketWithQr[]>([]);
  protected readonly orders = signal<readonly PaidOrder[]>([]);
  protected readonly pendingOrders = computed(() => {
    const issuedOrderIds = new Set(this.tickets().map((ticket) => ticket.order_id));
    return this.orders().filter(
      (order) => order.status === 'PAID' && !issuedOrderIds.has(order.order_id),
    );
  });
  protected readonly waitingForTicket = computed(
    () =>
      this.pendingOrderId !== null &&
      this.orders().some(
        (order) => order.order_id === this.pendingOrderId && order.status === 'PAID',
      ) &&
      !this.tickets().some((ticket) => ticket.order_id === this.pendingOrderId),
  );

  constructor() {
    void this.load();
    timer(5_000, 5_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.waitingForTicket()) void this.load(true);
      });
  }

  protected async load(silent = false): Promise<void> {
    if (this.requestRunning) return;
    this.requestRunning = true;
    if (!silent) this.status.set('loading');
    try {
      const [result, orderResult, teamResult] = await Promise.all([
        firstValueFrom(this.api.get<TicketsResponse>('ticket', '/customers/me/tickets')),
        firstValueFrom(this.api.get<OrdersResponse>('order', '/customers/me/orders')),
        firstValueFrom(this.api.get<TeamEventsResponse>('event', '/helper/shifts')).catch(
          () => ({ events: [] }) as TeamEventsResponse,
        ),
      ]);
      const teamEventIds = new Set(teamResult.events.map((event) => Number(event.event_id)));
      const visibleTickets = result.tickets.filter(
        (ticket) => !teamEventIds.has(Number(ticket.event_id)),
      );
      const visibleOrders = orderResult.orders.filter(
        (order) => !teamEventIds.has(Number(order.event_id)),
      );
      const withQr = await Promise.all(
        visibleTickets.map(async (ticket) => ({
          ...ticket,
          qrDataUrl: await toDataURL(ticket.qr_token, {
            width: 360,
            margin: 4,
            errorCorrectionLevel: 'M',
          }),
        })),
      );
      this.tickets.set(withQr);
      this.orders.set(visibleOrders);
      this.status.set('ready');
    } catch {
      if (!silent || this.tickets().length === 0) this.status.set('error');
    } finally {
      this.requestRunning = false;
    }
  }

  protected statusLabel(status: TicketStatus): string {
    return status === 'CHECKED_IN' ? 'Checked in' : status === 'VOID' ? 'Void' : 'Ready to scan';
  }

  protected money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(cents / 100);
  }
}
