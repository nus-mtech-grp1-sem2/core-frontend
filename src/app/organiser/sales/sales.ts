import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../core/api';
import { formatEventDate, formatEventTime, isCompleted } from '../../core/event-time';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

interface ManagedEventResponse {
  readonly events: readonly {
    readonly event_id: number;
    readonly title: string;
    readonly venue: string;
    readonly starts_at: string;
    readonly total_seats: number;
    readonly remaining_qty: number;
    readonly status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  }[];
}

interface OrdersSummaryResponse {
  readonly paidOrders: number;
  readonly ticketsSold: number;
  readonly revenueCents: number;
}

interface SalesRow {
  readonly eventId: number;
  readonly event: string;
  readonly venue: string;
  readonly sold: number;
  readonly paidOrders: number;
  readonly capacity: number;
  readonly revenue: number;
  readonly date: string;
  readonly time: string;
  readonly status: 'On sale' | 'Few left' | 'Sold out' | 'Completed' | 'Cancelled';
}

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Sold out means every ticket has really been sold. Stock that is only held or
 * reserved by buyers mid-checkout is not sold, so it never makes an event Sold out.
 */
function saleStatus(
  event: ManagedEventResponse['events'][number],
  sold: number,
  now: number,
): SalesRow['status'] {
  const capacity = Number(event.total_seats);
  if (isCompleted(event.starts_at, now)) return 'Completed';
  if (event.status === 'CANCELLED') return 'Cancelled';
  if (capacity > 0 && sold >= capacity) return 'Sold out';
  return capacity > 0 && event.remaining_qty / capacity < 0.15 ? 'Few left' : 'On sale';
}

/** Revenue and ticket sales per event, from the order service. */
@Component({
  selector: 'app-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Sales overview</h1>
          <p class="lead">Track revenue and ticket sales across your events.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (status()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading sales…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load sales figures.
              <button type="button" class="retry" (click)="load()">Try again</button>
            </p>
          }
          @case ('ready') {
            <ul class="stats">
              <li>
                <span class="stat-value">{{
                  totalRevenue() | currency: 'SGD' : 'S$' : '1.0-0'
                }}</span>
                <span class="stat-label">Total revenue</span>
              </li>
              <li>
                <span class="stat-value">{{ totalSold() }}</span>
                <span class="stat-label">Tickets sold</span>
              </li>
              <li>
                <span class="stat-value">{{
                  averageOrder() | currency: 'SGD' : 'S$' : '1.0-0'
                }}</span>
                <span class="stat-label">Average order value</span>
              </li>
            </ul>

            <div class="table-card">
              <table>
                <caption class="visually-hidden">
                  Sales by event
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Venue</th>
                    <th scope="col">Tickets sold</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Event date</th>
                    <th scope="col">Event time</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.eventId) {
                    <tr>
                      <th scope="row">{{ row.event }}</th>
                      <td>{{ row.venue }}</td>
                      <td>
                        {{ row.sold.toLocaleString('en-SG') }} /
                        {{ row.capacity.toLocaleString('en-SG') }}
                      </td>
                      <td>{{ row.revenue | currency: 'SGD' : 'S$' : '1.0-0' }}</td>
                      <td>{{ row.date }}</td>
                      <td>{{ row.time }}</td>
                      <td>
                        <span
                          class="pill status"
                          [class.on-sale]="row.status === 'On sale'"
                          [class.few-left]="row.status === 'Few left'"
                          [class.sold-out]="row.status === 'Sold out'"
                          [class.completed]="row.status === 'Completed'"
                          [class.cancelled]="row.status === 'Cancelled'"
                          >{{ row.status }}</span
                        >
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <p class="note">Revenue reflects paid orders only.</p>
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
    }

    .stats {
      list-style: none;
      margin: 0 0 1.5rem;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    .stats li {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
      background: var(--bg);
    }

    .stat-value {
      display: block;
      font-family: var(--font-display);
      font-size: 1.75rem;
      font-weight: 700;
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .table-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      background: var(--bg);
    }

    table {
      width: 100%;
      min-width: 56rem;
      border-collapse: collapse;
      font-size: 0.9375rem;
    }

    th,
    td {
      text-align: left;
      padding: 0.875rem 1.25rem;
    }

    thead th {
      background: var(--bg-subtle);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }

    tbody tr + tr th,
    tbody tr + tr td {
      border-top: 1px solid var(--border);
    }

    .note {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    @media (max-width: 720px) {
      .stats {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Sales {
  private readonly api = inject(ApiService);

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly rows = signal<readonly SalesRow[]>([]);

  protected readonly totalRevenue = computed(() =>
    this.rows().reduce((sum, row) => sum + row.revenue, 0),
  );

  protected readonly totalSold = computed(() =>
    this.rows().reduce((sum, row) => sum + row.sold, 0),
  );

  private readonly totalPaidOrders = computed(() =>
    this.rows().reduce((sum, row) => sum + row.paidOrders, 0),
  );

  protected readonly averageOrder = computed(() => {
    const paidOrders = this.totalPaidOrders();
    return paidOrders ? this.totalRevenue() / paidOrders : 0;
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      const managed = await firstValueFrom(
        this.api.get<ManagedEventResponse>('event', '/events/manage'),
      );
      const rows = await Promise.all(
        managed.events.map(async (event): Promise<SalesRow> => {
          const summary = await firstValueFrom(
            this.api.get<OrdersSummaryResponse>(
              'order',
              `/events/${event.event_id}/orders/summary`,
            ),
          ).catch(() => ({ paidOrders: 0, ticketsSold: 0, revenueCents: 0 }));

          const sold = Number(summary.ticketsSold);
          return {
            eventId: event.event_id,
            event: event.title,
            venue: event.venue,
            sold,
            paidOrders: Number(summary.paidOrders),
            capacity: Number(event.total_seats),
            revenue: Number(summary.revenueCents) / 100,
            date: formatEventDate(event.starts_at),
            time: formatEventTime(event.starts_at),
            status: saleStatus(event, sold, Date.now()),
          };
        }),
      );
      this.rows.set(rows);
      this.status.set('ready');
    } catch {
      this.status.set('error');
    }
  }
}
