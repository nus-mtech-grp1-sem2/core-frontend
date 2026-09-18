import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, timer } from 'rxjs';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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
interface Order {
  readonly order_id: number;
  readonly event_id: number;
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly status: string;
  readonly total_amount_cents: number;
}

interface OrdersResponse {
  readonly orders: readonly Order[];
}

interface TicketWithQr extends Ticket {
  readonly qrDataUrl: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

/** The signed-in customer's own issued tickets, each with a scannable QR code. */
@Component({
  selector: 'app-my-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DatePipe, RouterLink, WorkspaceShell],
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
            <strong>Payment successful.</strong> Your purchase is shown below. The QR ticket will appear when issuance completes.
          </div>
        }
        @switch (status()) {
          @case ('loading') { <p class="status-message" role="status">Loading your tickets…</p> }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load your tickets. <button type="button" class="retry" (click)="load()">Try again</button>
            </p>
          }
          @case ('ready') {
            @if (pendingOrders().length > 0) {
              <section class="pending-list" aria-label="Paid orders awaiting tickets">
                @for (order of pendingOrders(); track order.order_id) {
                  <article class="ticket-card pending-card">
                    <div class="ticket-placeholder" aria-hidden="true">✓</div>
                    <div class="details">
                      <h2><a [routerLink]="['/events', order.event_id]">{{ order.event_title }}</a></h2>
                      <p>{{ order.venue }} · {{ order.starts_at | date: 'EEE d MMM y, h:mm a' }}</p>
                      <dl>
                        <div><dt>Tickets</dt><dd>{{ order.ticket_count }}</dd></div>
                        <div><dt>Paid</dt><dd>{{ money(order.total_amount_cents, order.currency) }}</dd></div>
                        <div><dt>Status</dt><dd>Payment received · issuing ticket</dd></div>
                      </dl>
                    </div>
                  </article>
                }
              </section>
            }
            <section class="orders" aria-labelledby="orders-heading">
              <h2 id="orders-heading">Orders</h2>
              @for (order of orders(); track order.order_id) {
                <article class="order-row">
                  <div>
                    <strong>{{ order.event_title }}</strong>
                    <span>{{ order.venue }} · {{ order.starts_at | date: 'EEE d MMM y, h:mm a' }}</span>
                  </div>
                  <div>
                    <span>Order #{{ order.order_id }}</span>
                    <strong>{{ order.total_amount_cents / 100 | currency: 'SGD' : 'S$' : '1.2-2' }}</strong>
                  </div>
                </article>
              } @empty {
                <p class="empty">No orders yet.</p>
              }
            </section>
            <ul class="ticket-list">
              @for (ticket of tickets(); track ticket.ticket_id) {
                <li>
                  <article class="ticket-card">
                    <img class="qr" [src]="ticket.qrDataUrl" [alt]="'QR code for ticket ' + ticket.ticket_id" />
                    <div class="details">
                      <h2><a [routerLink]="['/events', ticket.event_id]">{{ ticket.event_title }}</a></h2>
                      <p>{{ ticket.venue }} · {{ ticket.starts_at | date: 'EEE d MMM y, h:mm a' }}</p>
                      <dl>
                        @if (ticket.seat_label) { <div><dt>Seat</dt><dd>{{ ticket.seat_label }}</dd></div> }
                        <div><dt>Status</dt><dd>{{ statusLabel(ticket.status) }}</dd></div>
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
    .body { padding-block: clamp(2rem, 5vw, 3rem); }
    .issuance { margin-bottom: 1rem; padding: .875rem 1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--success-bg); color: var(--success-fg); }
    .orders { margin-bottom: 2rem; }
    .orders h2 { margin-bottom: .75rem; }
    .order-row { display: flex; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-top: 1px solid var(--border); }
    .order-row div { display: grid; gap: .25rem; }
    .order-row span { color: var(--text-muted); font-size: .875rem; }
    .ticket-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
    .pending-list { display: grid; gap: 1rem; margin-bottom: 1rem; }
    .ticket-card { display: grid; grid-template-columns: 6.5rem 1fr; gap: 1.25rem; align-items: center; padding: 1.25rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); }
    .qr { width: 6.5rem; height: 6.5rem; border-radius: var(--radius); }
    .ticket-placeholder { display: grid; place-items: center; width: 6.5rem; height: 6.5rem; border-radius: var(--radius); background: var(--success-bg); color: var(--success-fg); font-size: 2rem; font-weight: 700; }
    h2 { margin: 0; font-size: 1.125rem; }
    h2 a { color: var(--text); text-decoration: none; }
    h2 a:hover { color: var(--brand-600); text-decoration: underline; }
    .details > p { margin: .25rem 0 .875rem; color: var(--text-muted); }
    dl { display: flex; flex-wrap: wrap; gap: .75rem 2rem; margin: 0; }
    dl div { display: grid; gap: .125rem; }
    dt { color: var(--text-muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; }
    dd { margin: 0; font-size: .875rem; }
    .empty { padding: 2rem; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); }
    .empty p { color: var(--text-muted); }
    @media (max-width: 720px) { .ticket-card { grid-template-columns: 1fr; justify-items: start; } }
  `,
})
export class MyEvents {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private requestRunning = false;
  private readonly pendingOrderId = Number(this.route.snapshot.queryParamMap.get('orderId')) || null;
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly tickets = signal<readonly TicketWithQr[]>([]);
  protected readonly orders = signal<readonly PaidOrder[]>([]);
  protected readonly pendingOrders = computed(() => {
    const issuedOrderIds = new Set(this.tickets().map((ticket) => ticket.order_id));
    return this.orders().filter((order) => order.status === 'PAID' && !issuedOrderIds.has(order.order_id));
  });
  protected readonly waitingForTicket = computed(() =>
    this.pendingOrderId !== null && !this.tickets().some((ticket) => ticket.order_id === this.pendingOrderId),
  );
  protected readonly orders = signal<readonly Order[]>([]);

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
      const [result, orderResult] = await Promise.all([
        firstValueFrom(this.api.get<TicketsResponse>('ticket', '/customers/me/tickets')),
        firstValueFrom(this.api.get<OrdersResponse>('order', '/customers/me/orders')),
      ]);
      const withQr = await Promise.all(
        result.tickets.map(async (ticket) => ({
          ...ticket,
          qrDataUrl: await toDataURL(ticket.qr_token, { width: 160, margin: 1 }),
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

  protected statusLabel(status: TicketStatus): string {
    return status === 'CHECKED_IN' ? 'Checked in' : status === 'VOID' ? 'Void' : 'Ready to scan';
  }

  protected money(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-SG', { style: 'currency', currency }).format(cents / 100);
  }
}
