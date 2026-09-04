import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { ApiService } from '../../core/api';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

interface EventOption {
  readonly id: number;
  readonly title: string;
}

interface EventResponse {
  readonly events: readonly {
    readonly event_id: number;
    readonly title?: string;
    readonly event_name?: string;
  }[];
}

interface AttendeeRow {
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
                        <th scope="col">Buyer</th>
                        <th scope="col">Email</th>
                        <th scope="col">Ticket type</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Order date</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of attendees(); track row.email) {
                        <tr>
                          <th scope="row">{{ row.buyer }}</th>
                          <td><a [href]="'mailto:' + row.email">{{ row.email }}</a></td>
                          <td>{{ row.ticketType }}</td>
                          <td>{{ row.quantity }}</td>
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
    this.api.get<EventResponse>('event', '/events').subscribe({
      next: (result) => {
        const events = result.events.map((event) => ({
          id: event.event_id,
          title: event.title ?? event.event_name ?? `Event ${event.event_id}`,
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
    this.api.get<AttendeeRow[]>('order', `/attendees?eventId=${eventId}`).subscribe({
      next: (rows) => {
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
