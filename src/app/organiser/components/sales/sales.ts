import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api';
import { formatEventDate, formatEventTime, isCompleted } from '../../../core/event-time';
import { WorkspaceShell } from '../../../layout/components/workspace-shell/workspace-shell';
import { StatsSummary, SummaryStat } from '../../../shared/components/stats-summary/stats-summary';

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
  imports: [StatsSummary, CurrencyPipe, WorkspaceShell],
  templateUrl: './sales.html',
  styleUrl: './sales.css',
})
export class Sales implements OnInit {
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

  protected readonly summaryStats = computed<readonly SummaryStat[]>(() => [
    { label: 'Total revenue', value: this.totalRevenue(), currency: true },
    { label: 'Tickets sold', value: this.totalSold() },
    { label: 'Average order value', value: this.averageOrder(), currency: true },
  ]);

  ngOnInit(): void {
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
