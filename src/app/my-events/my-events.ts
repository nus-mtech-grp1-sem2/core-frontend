import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { Order } from '../core/catalog';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Paid ticket orders grouped by the event they grant access to. */
@Component({
  selector: 'app-my-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="customer">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Your account</p>
          <h1>My events</h1>
          <p class="lead">Events for which you have purchased tickets.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (status()) {
          @case ('loading') { <p class="status-message" role="status">Loading your events…</p> }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load your events. <button type="button" class="retry" (click)="load()">Try again</button>
            </p>
          }
          @case ('ready') {
            <ul class="event-list">
              @for (order of orders(); track order.reference) {
                <li>
                  <article class="event-card">
                    <div class="when"><span>{{ order.date }}</span><strong>{{ order.time }}</strong></div>
                    <div class="details">
                      <h2><a [routerLink]="['/events', order.eventId]">{{ order.event }}</a></h2>
                      <p>{{ order.venue }}</p>
                      <dl>
                        <div><dt>Tickets</dt><dd>{{ order.quantity }}</dd></div>
                        <div><dt>Type / seats</dt><dd>{{ order.seats }}</dd></div>
                        <div><dt>Order</dt><dd>{{ order.reference }}</dd></div>
                      </dl>
                    </div>
                    <div class="actions">
                      <a class="btn btn-ghost btn-sm" [routerLink]="['/events', order.eventId]">View event</a>
                      <button type="button" class="btn btn-ghost btn-sm danger" (click)="remove(order)">Delete</button>
                    </div>
                  </article>
                </li>
              } @empty {
                <li class="empty">
                  <h2>No purchased events yet</h2>
                  <p>Paid tickets will appear here.</p>
                  <a class="btn btn-primary" routerLink="/tickets">Browse tickets</a>
                </li>
              }
            </ul>
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body { padding-block: clamp(2rem, 5vw, 3rem); }
    .event-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem; }
    .event-card { display: grid; grid-template-columns: 10rem 1fr auto; gap: 1.5rem; align-items: center; padding: 1.25rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); }
    .when { display: grid; gap: .25rem; color: var(--text-muted); font-size: .875rem; }
    .when strong { color: var(--text); font-size: 1rem; }
    h2 { margin: 0; font-size: 1.125rem; }
    h2 a { color: var(--text); text-decoration: none; }
    h2 a:hover { color: var(--brand-600); text-decoration: underline; }
    .details > p { margin: .25rem 0 .875rem; color: var(--text-muted); }
    dl { display: flex; flex-wrap: wrap; gap: .75rem 2rem; margin: 0; }
    dl div { display: grid; gap: .125rem; }
    dt { color: var(--text-muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; }
    dd { margin: 0; font-size: .875rem; }
    .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    .danger { color: #8c1d18; border-color: #d9a3a0; }
    .empty { padding: 2rem; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); }
    .empty p { color: var(--text-muted); }
    @media (max-width: 720px) { .event-card { grid-template-columns: 1fr; } .event-card > .btn { justify-self: start; } }
  `,
})
export class MyEvents {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly orders = signal<readonly Order[]>([]);

  constructor() { this.load(); }

  protected load(): void {
    const email = this.auth.user()?.email;
    if (!email) { this.orders.set([]); this.status.set('ready'); return; }
    this.status.set('loading');
    this.api.get<Order[]>('order', `/orders?email=${encodeURIComponent(email)}`).subscribe({
      next: (orders) => { this.orders.set(orders); this.status.set('ready'); },
      error: () => this.status.set('error'),
    });
  }

  protected remove(order: Order): void {
    if (!window.confirm(`Cancel order ${order.reference} and remove ${order.event} from My events?`)) return;
    const email = encodeURIComponent(this.auth.user()?.email ?? '');
    this.api.delete<void>('order', `/orders/${encodeURIComponent(order.reference)}?email=${email}`).subscribe({
      next: () => this.orders.update((orders) => orders.filter((item) => item.reference !== order.reference)),
      error: () => window.alert('This order could not be cancelled.'),
    });
  }
}
