import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventListing } from '../core/catalog';
import { formatEventDate, formatEventTime, isCompleted } from '../core/event-time';
import { WorkspaceShell } from '../layout/components/workspace-shell/workspace-shell';
import { StatsSummary, SummaryStat } from '../shared/components/stats-summary/stats-summary';

type LoadStatus = 'loading' | 'ready' | 'error';

interface ManagedEventResponse {
  readonly events: readonly {
    readonly event_id: number;
    readonly title: string;
    readonly description: string | null;
    readonly venue: string;
    readonly starts_at: string;
    readonly total_seats: number;
    readonly remaining_qty: number;
    readonly price_cents: number | null;
    readonly tier: 'TIER1_GA' | 'TIER2_SEATED';
    readonly status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  }[];
}

/** An event that has already started is 'Completed', whatever its remaining stock. */
type OrganiserEvent = Omit<EventListing, 'status'> & {
  readonly status: EventListing['status'] | 'Completed';
};

function saleStatus(
  event: ManagedEventResponse['events'][number],
  now: number,
): OrganiserEvent['status'] {
  if (isCompleted(event.starts_at, now)) return 'Completed';
  if (event.status === 'CANCELLED' || event.remaining_qty <= 0) return 'Sold out';
  return event.remaining_qty / event.total_seats < 0.15 ? 'Few left' : 'On sale';
}

/** Organiser workspace: every event, its sale status, and a link to edit it. */
@Component({
  selector: 'app-organiser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatsSummary, RouterLink, WorkspaceShell],
  templateUrl: './organiser.html',
  styleUrl: './organiser.css',
})
export class Organiser {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly events = signal<readonly OrganiserEvent[]>([]);

  protected readonly onSale = computed(
    () =>
      this.events().filter((event) => event.status === 'On sale' || event.status === 'Few left')
        .length,
  );

  protected readonly completed = computed(
    () => this.events().filter((event) => event.status === 'Completed').length,
  );

  protected readonly lowestPrice = computed(() => {
    const events = this.events();
    return events.length ? Math.min(...events.map((event) => event.priceFrom)) : 0;
  });

  protected readonly summaryStats = computed<readonly SummaryStat[]>(() => [
    { label: 'Events listed', value: this.events().length },
    { label: 'On sale now', value: this.onSale() },
    { label: 'Completed events', value: this.completed() },
    { label: 'Lowest ticket price', value: this.lowestPrice(), currency: true },
  ]);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.status.set('loading');
    this.api.get<ManagedEventResponse>('event', '/events/manage').subscribe({
      next: (result) => {
        const now = Date.now();
        const events = result.events.map((event): OrganiserEvent => ({
          id: event.event_id,
          title: event.title,
          description: event.description ?? '',
          category: event.tier === 'TIER2_SEATED' ? 'Theatre' : 'Concerts',
          venueId: event.event_id,
          venue: event.venue,
          date: formatEventDate(event.starts_at),
          time: formatEventTime(event.starts_at),
          featured: false,
          priceFrom: (event.price_cents ?? 0) / 100,
          image: 'images/hero-concert.jpg',
          alt: `${event.title} artwork`,
          status: saleStatus(event, now),
        }));
        this.events.set(events);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }
}
