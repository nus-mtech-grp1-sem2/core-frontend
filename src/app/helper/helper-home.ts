import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Current event-service response used as the helper's read-only shift list. */
interface HelperEventDto {
  readonly event_id: number;
  readonly title?: string;
  readonly event_name?: string;
  readonly venue: string;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
  readonly total_seats: number;
}

interface HelperEventsResponse {
  readonly events: readonly HelperEventDto[];
}

interface ShiftView {
  readonly id: number;
  readonly event: string;
  readonly venue: string;
  readonly gate: string;
  readonly date: string;
  readonly doorsOpen: string;
  readonly expected: number;
  readonly today: boolean;
}

/**
 * Home page for an event helper: the shift they are working now, then the ones
 * coming up. Backed by the event service's staffing endpoint — see
 * `backend-repo/API_DESIGN.md` §1 ("Event-helper" / `event_staff`).
 */
@Component({
  selector: 'app-helper-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="event-helper">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Event helper</p>
          <h1>{{ greeting() }}</h1>
          <p class="lead">
            {{
              today()
                ? 'You are on the door tonight. Open check-in when the queue starts moving.'
                : 'No shift today. Your next one is listed below.'
            }}
          </p>
        </div>
      </section>

      <section class="shell body">
      @switch (status()) {
        @case ('loading') {
          <p class="status-message" role="status">Loading your shifts…</p>
        }
        @case ('error') {
          <p class="status-message error" role="alert">
            Couldn't load your shifts.
            <button type="button" class="retry" (click)="loadShifts()">Try again</button>
          </p>
        }
        @case ('ready') {
          @if (today(); as shift) {
            <article class="on-now">
              <div class="on-now-head">
                <span class="pill live">On tonight</span>
                <span class="doors">Doors {{ shift.doorsOpen }}</span>
              </div>
              <h2>{{ shift.event }}</h2>
              <p class="where">{{ shift.venue }} · {{ shift.gate }}</p>
              <dl class="facts">
                <div>
                  <dt>Date</dt>
                  <dd>{{ shift.date }}</dd>
                </div>
                <div>
                  <dt>Expected</dt>
                  <dd>{{ shift.expected.toLocaleString('en-SG') }} attendees</dd>
                </div>
              </dl>
              <a class="btn btn-primary" [routerLink]="['/checkin', shift.id]">Open door check-in</a>
            </article>
          }

          <h2 class="section-title">Upcoming shifts</h2>
          <ul class="shifts">
            @for (shift of upcoming(); track shift.id) {
              <li>
                <div class="when">
                  <span class="date">{{ shift.date }}</span>
                  <span class="time">Doors {{ shift.doorsOpen }}</span>
                </div>
                <div class="what">
                  <span class="event">{{ shift.event }}</span>
                  <span class="venue">{{ shift.venue }} · {{ shift.gate }}</span>
                </div>
                <span class="count">{{ shift.expected.toLocaleString('en-SG') }}</span>
              </li>
            } @empty {
              <li class="empty">Nothing scheduled after tonight.</li>
            }
          </ul>

          <p class="note">
            Scans are recorded against your account, so the log shows who admitted each ticket.
          </p>
        }
      }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .on-now {
      border: 1px solid var(--border);
      border-left: 4px solid var(--brand-500);
      border-radius: var(--radius-lg);
      background: var(--bg);
      box-shadow: var(--shadow-sm);
      padding: clamp(1.25rem, 3vw, 1.75rem);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: flex-start;
    }

    .on-now-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .live {
      background: var(--success-bg);
      color: var(--success-fg);
    }

    .doors {
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .on-now h2 {
      font-size: clamp(1.25rem, 3vw, 1.625rem);
    }

    .where {
      color: var(--text-muted);
      font-size: 0.9375rem;
    }

    .facts {
      display: flex;
      gap: 2.5rem;
      margin: 0.75rem 0 1rem;
    }

    .facts dt {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }

    .facts dd {
      margin: 0.125rem 0 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .section-title {
      font-size: 1.125rem;
      margin-top: 0.5rem;
    }

    .shifts {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg);
    }

    .shifts li {
      display: grid;
      grid-template-columns: 12rem 1fr auto;
      gap: 1rem;
      align-items: center;
      padding: 0.875rem 1.25rem;
    }

    .shifts li + li {
      border-top: 1px solid var(--border);
    }

    .when,
    .what {
      display: grid;
      gap: 0.125rem;
      min-width: 0;
    }

    .date,
    .event {
      font-weight: 600;
      font-size: 0.9375rem;
    }

    .time,
    .venue {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .count {
      font-variant-numeric: tabular-nums;
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .empty {
      color: var(--text-muted);
      font-size: 0.9375rem;
    }

    .note {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    @media (max-width: 700px) {
      .shifts li {
        grid-template-columns: 1fr auto;
      }

      .when {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class HelperHome {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly status = signal<LoadStatus>('loading');
  private readonly shifts = signal<readonly ShiftView[]>([]);

  protected readonly today = computed(() => this.shifts().find((shift) => shift.today) ?? null);
  protected readonly upcoming = computed(() => this.shifts().filter((shift) => !shift.today));

  protected readonly greeting = computed(() => {
    const email = this.auth.user()?.email ?? '';
    const name = email.split('@')[0];
    return name ? `Welcome, ${name}` : 'Welcome';
  });

  constructor() {
    this.loadShifts();
  }

  protected loadShifts(): void {
    this.status.set('loading');
    const now = new Date();

    this.api.get<HelperEventsResponse>('event', '/helper/shifts').subscribe({
      next: (result) => {
        this.shifts.set(result.events.map((event) => toShiftView(event, now)));
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }
}

function toShiftView(dto: HelperEventDto, now: Date): ShiftView {
  const eventStart = new Date(dto.starts_at ?? dto.event_start_datetime ?? '');
  const doorsOpen = new Date(eventStart.getTime() - 60 * 60 * 1000);

  return {
    id: dto.event_id,
    event: dto.title ?? dto.event_name ?? `Event ${dto.event_id}`,
    venue: dto.venue,
    gate: 'Gate TBC',
    date: formatDate(eventStart, 'EEE d MMM yyyy', 'en-SG'),
    doorsOpen: formatDate(doorsOpen, 'h:mm a', 'en-SG'),
    expected: dto.total_seats,
    today: isSameDay(eventStart, now),
  };
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
