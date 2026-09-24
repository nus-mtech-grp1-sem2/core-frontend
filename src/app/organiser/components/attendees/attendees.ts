import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { ApiService } from '../../../core/api';
import { WorkspaceShell } from '../../../layout/components/workspace-shell/workspace-shell';

interface EventOption {
  readonly id: number;
  readonly title: string;
}

interface ManagedEventResponse {
  readonly events: readonly {
    readonly event_id: number;
    readonly title: string;
  }[];
}

interface AttendeesResponse {
  readonly attendees: readonly {
    readonly order_id: number;
    readonly customer_email: string;
    readonly paid_at: string | null;
    readonly description: string;
    readonly quantity: number;
    readonly seat_id: number | null;
  }[];
}

interface AttendeeRow {
  readonly id: string;
  readonly buyer: string;
  readonly email: string;
  readonly ticketType: string;
  readonly quantity: number;
  readonly orderedAt: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

/** Who has bought tickets for a given event, from the order service. */
@Component({
  selector: 'app-attendees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkspaceShell],
  templateUrl: './attendees.html',
  styleUrl: './attendees.css',
})
export class Attendees {
  private readonly api = inject(ApiService);

  protected readonly eventsStatus = signal<LoadStatus>('loading');
  protected readonly events = signal<readonly EventOption[]>([]);
  protected readonly selectedEventId = signal<number | null>(null);

  protected readonly selectedEvent = computed(() =>
    this.events().find((event) => event.id === this.selectedEventId()),
  );

  protected readonly attendeesStatus = signal<LoadStatus>('loading');
  protected readonly attendees = signal<readonly AttendeeRow[]>([]);

  constructor() {
    this.loadEvents();

    // Re-fetch the roster whenever the selected event changes.
    effect(() => {
      const eventId = this.selectedEventId();
      if (eventId !== null) {
        this.loadAttendees();
      }
    });
  }

  protected loadEvents(): void {
    this.eventsStatus.set('loading');
    this.api.get<ManagedEventResponse>('event', '/events/manage').subscribe({
      next: (result) => {
        const events = result.events.map((event) => ({
          id: event.event_id,
          title: event.title,
        }));
        this.events.set(events);
        this.eventsStatus.set('ready');
        if (events.length) {
          this.selectedEventId.set(events[0].id);
        }
      },
      error: () => this.eventsStatus.set('error'),
    });
  }

  protected loadAttendees(): void {
    const eventId = this.selectedEventId();
    if (eventId === null) {
      return;
    }

    this.attendeesStatus.set('loading');
    this.api.get<AttendeesResponse>('order', `/events/${eventId}/attendees`).subscribe({
      next: (result) => {
        this.attendees.set(
          result.attendees.map((attendee) => ({
            id: `${attendee.order_id}:${attendee.seat_id ?? 'ga'}:${attendee.description}`,
            buyer: attendee.customer_email,
            email: attendee.customer_email,
            ticketType:
              attendee.description ||
              (attendee.seat_id === null ? 'General admission' : `Seat ${attendee.seat_id}`),
            quantity: Number(attendee.quantity),
            orderedAt: attendee.paid_at
              ? new Date(attendee.paid_at).toLocaleString('en-SG')
              : 'Not recorded',
          })),
        );
        this.attendeesStatus.set('ready');
      },
      error: () => this.attendeesStatus.set('error'),
    });
  }

  protected onEventChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedEventId.set(value);
  }
}
