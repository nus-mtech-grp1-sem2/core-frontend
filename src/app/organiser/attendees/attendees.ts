import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

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
    readonly ticket_id: number;
    readonly customer_email: string;
    readonly seat_label: string | null;
    readonly status: 'ISSUED' | 'CHECKED_IN' | 'VOID';
    readonly total_amount_cents: number;
    readonly paid_at: string | null;
  }[];
}

interface AttendeeRow {
  readonly ticketId: number;
  readonly email: string;
  readonly seatLabel: string;
  readonly status: 'ISSUED' | 'CHECKED_IN' | 'VOID';
  readonly amountPaid: number;
  readonly orderedAt: string;
}

type LoadStatus = 'loading' | 'ready' | 'error';

/** Who has bought tickets for a given event, from the order service. */
@Component({
  selector: 'app-attendees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Attendees</h1>
          <p class="lead">See who's bought tickets for each event.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (eventsStatus()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading events…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load events.
              <button type="button" class="retry" (click)="loadEvents()">Try again</button>
            </p>
          }
          @case ('ready') {
            <div class="field filter">
              <label for="event">Filter by event</label>
              <select id="event" [value]="selectedEventId()" (change)="onEventChange($event)">
                @for (event of events(); track event.id) {
                  <option [value]="event.id">{{ event.title }}</option>
                }
              </select>
            </div>

            @switch (attendeesStatus()) {
              @case ('loading') {
                <p class="status-message" role="status">Loading attendees…</p>
              }
              @case ('error') {
                <p class="status-message error" role="alert">
                  Couldn't load attendees.
                  <button type="button" class="retry" (click)="loadAttendees()">Try again</button>
                </p>
              }
              @case ('ready') {
                <div class="table-card">
                  <table>
                    <caption class="visually-hidden">
                      Attendees for {{ selectedEvent()?.title }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Email</th>
                        <th scope="col">Seat</th>
                        <th scope="col">Ticket status</th>
                        <th scope="col">Amount paid</th>
                        <th scope="col">Paid on</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of attendees(); track row.ticketId) {
                        <tr>
                          <th scope="row"><a [href]="'mailto:' + row.email">{{ row.email }}</a></th>
                          <td>{{ row.seatLabel }}</td>
                          <td>{{ row.status }}</td>
                          <td>{{ row.amountPaid | currency: 'SGD' : 'S$' : '1.2-2' }}</td>
                          <td>{{ row.orderedAt }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="empty">No one has bought a ticket for this event yet.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }

            <p class="note">Attendee data reflects paid orders only.</p>
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
    }

    .filter {
      max-width: 20rem;
      margin-bottom: 1.5rem;
    }

    .filter select {
      font: inherit;
      font-size: 0.9375rem;
      padding: 0.6875rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--bg);
      color: var(--text);
    }

    .table-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      background: var(--bg);
    }

    table {
      width: 100%;
      min-width: 44rem;
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

    td a {
      color: var(--brand-600);
      text-decoration: none;
    }

    td a:hover {
      text-decoration: underline;
    }

    .empty {
      color: var(--text-muted);
    }

    .note {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
  `,
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
    // /events/manage (not the public /events listing) so this page only
    // ever offers events this organiser actually runs — matches what the
    // attendees endpoint itself is gated on.
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
    this.api.get<AttendeesResponse>('ticket', `/events/${eventId}/attendees`).subscribe({
      next: (result) => {
        const rows = result.attendees.map(
          (attendee): AttendeeRow => ({
            ticketId: attendee.ticket_id,
            email: attendee.customer_email,
            seatLabel: attendee.seat_label ?? 'General admission',
            status: attendee.status,
            amountPaid: attendee.total_amount_cents / 100,
            orderedAt: attendee.paid_at ? new Date(attendee.paid_at).toLocaleDateString('en-SG') : '—',
          }),
        );
        this.attendees.set(rows);
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
