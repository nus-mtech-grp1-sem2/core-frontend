import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventListing } from '../core/catalog';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Organiser workspace: every event, its sale status, and a link to edit it. */
@Component({
  selector: 'app-organiser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Your events</h1>
          <p class="lead">Signed in as {{ auth.user()?.email }}.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (status()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading your events…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load your events.
              <button type="button" class="retry" (click)="load()">Try again</button>
            </p>
          }
          @case ('ready') {
            <ul class="stats">
              <li>
                <span class="stat-value">{{ events().length }}</span>
                <span class="stat-label">Events listed</span>
              </li>
              <li>
                <span class="stat-value">{{ onSale() }}</span>
                <span class="stat-label">On sale now</span>
              </li>
              <li>
                <span class="stat-value">{{ lowestPrice() | currency: 'SGD' : 'S$' : '1.0-0' }}</span>
                <span class="stat-label">Lowest ticket price</span>
              </li>
            </ul>

            <div class="table-card">
              <table>
                <caption class="visually-hidden">
                  Events you manage
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Venue</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (event of events(); track event.id) {
                    <tr>
                      <th scope="row">{{ event.title }}</th>
                      <td>{{ event.venue }}</td>
                      <td>{{ event.date }}</td>
                      <td>
                        <span
                          class="pill status"
                          [class.on-sale]="event.status === 'On sale'"
                          [class.few-left]="event.status === 'Few left'"
                          [class.sold-out]="event.status === 'Sold out'"
                          >{{ event.status }}</span
                        >
                      </td>
                      <td class="actions">
                        <a class="btn btn-primary btn-sm" [routerLink]="['/organiser/events', event.id, 'edit']">
                          Update
                          <span class="visually-hidden"> {{ event.title }}</span>
                        </a>
                        <button type="button" class="btn btn-ghost btn-sm danger" (click)="remove(event)">Delete</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <p class="note">
              Creating and editing events will call the event service once those endpoints exist.
            </p>
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
      min-width: 40rem;
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

    .actions {
      text-align: right;
      white-space: nowrap;
    }
    .actions .btn + .btn { margin-left: .5rem; }
    .danger { color: #8c1d18; border-color: #d9a3a0; }

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
export class Organiser {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly events = signal<readonly EventListing[]>([]);

  protected readonly onSale = computed(
    () => this.events().filter((event) => event.status !== 'Sold out').length,
  );

  protected readonly lowestPrice = computed(() => {
    const events = this.events();
    return events.length ? Math.min(...events.map((event) => event.priceFrom)) : 0;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.status.set('loading');
    const email = encodeURIComponent(this.auth.user()?.email ?? '');
    this.api.get<EventListing[]>('event', `/events?organizerEmail=${email}`).subscribe({
      next: (events) => {
        this.events.set(events);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }

  protected remove(event: EventListing): void {
    if (!window.confirm(`Cancel and remove ${event.title} from active event listings?`)) return;
    const email = encodeURIComponent(this.auth.user()?.email ?? '');
    this.api.delete<void>('event', `/events/${event.id}?organizerEmail=${email}`).subscribe({
      next: () => this.events.update((events) => events.filter((item) => item.id !== event.id)),
      error: () => window.alert('This event could not be deleted. Only its creator can delete it.'),
    });
  }
}
