import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AuthService } from '../core/auth';
import { EVENTS } from '../core/catalog';

/**
 * Organiser workspace. Scaffolding: the figures are derived from the sample
 * catalogue, and the actions are not wired to the event service yet.
 */
@Component({
  selector: 'app-organiser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  template: `
    <section class="page-head">
      <div class="shell">
        <p class="eyebrow">Organiser</p>
        <h1>Your events</h1>
        <p class="lead">Signed in as {{ auth.user()?.email }}.</p>
      </div>
    </section>

    <section class="shell body">
      <ul class="stats">
        <li>
          <span class="stat-value">{{ events.length }}</span>
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
            </tr>
          </thead>
          <tbody>
            @for (event of events; track event.id) {
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
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="note">
        Creating and editing events will call the event service once those endpoints exist.
      </p>
    </section>
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
  protected readonly auth = inject(AuthService);
  protected readonly events = EVENTS;

  protected readonly onSale = computed(
    () => this.events.filter((event) => event.status !== 'Sold out').length,
  );

  protected readonly lowestPrice = computed(() =>
    Math.min(...this.events.map((event) => event.priceFrom)),
  );
}
