import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';

interface ScanResult {
  readonly code: string;
  readonly outcome: 'admitted' | 'duplicate' | 'unknown' | 'wrong_event';
  readonly at: string;
}

interface SearchResult {
  readonly ticketId: number;
  readonly code: string;
  readonly name: string;
  readonly email: string;
  readonly orderNumber: string;
  readonly status: string;
}

interface CheckInStats {
  readonly sold: number;
  readonly checkedIn: number;
}

/**
 * Door workspace for event helpers. The event id comes from the helper's
 * assigned shift, so every validation and search is scoped to that event.
 */
@Component({
  selector: 'app-checkin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <section class="page-head">
      <div class="shell">
        <p class="eyebrow">Event helper</p>
        <h1>Door check-in</h1>
        <p class="lead">Signed in as {{ auth.user()?.email }}.</p>
      </div>
    </section>

    <section class="shell body">
      @if (stats(); as currentStats) {
        <div class="stats" aria-live="polite">
          <strong>{{ currentStats.checkedIn }}</strong> checked in
          <span>of {{ currentStats.sold }} tickets sold</span>
        </div>
      }
      <form [formGroup]="form" (ngSubmit)="scan()" novalidate class="scan">
        <div class="field">
          <label for="code">Ticket code</label>
          <input
            id="code"
            type="text"
            formControlName="code"
            placeholder="TKT-1001"
            autocomplete="off"
          />
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="busy()">Check in</button>
      </form>

      <form [formGroup]="searchForm" (ngSubmit)="search()" novalidate class="search">
        <label for="search">Find by name, email, or order ID</label>
        <div class="search-row">
          <input id="search" type="search" formControlName="query" placeholder="Jamie, jamie@example.com, ONE-..." />
          <button class="btn btn-ghost" type="submit" [disabled]="busy()">Search</button>
        </div>
      </form>

      @if (searchMessage(); as message) {
        <p class="status-message" role="status">{{ message }}</p>
      }
      @if (searchResults().length) {
        <ul class="results">
          @for (ticket of searchResults(); track ticket.ticketId) {
            <li>
              <div><strong>{{ ticket.name }}</strong><span>{{ ticket.email }} · {{ ticket.orderNumber }}</span></div>
              <button class="btn btn-ghost" type="button" (click)="scanCode(ticket.code)">Check in</button>
            </li>
          }
        </ul>
      }

      @if (last(); as result) {
        <p
          class="verdict"
          role="status"
          [class.ok]="result.outcome === 'admitted'"
          [class.warn]="result.outcome === 'duplicate'"
          [class.bad]="result.outcome === 'unknown' || result.outcome === 'wrong_event'"
        >
          {{ describe(result) }}
        </p>
      }

      <h2>This session</h2>
      @if (scans().length) {
        <ul class="log">
          @for (scan of scans(); track scan.code + scan.at) {
            <li>
              <span class="code">{{ scan.code }}</span>
              <span class="outcome">{{ describe(scan) }}</span>
              <span class="at">{{ scan.at }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">No tickets scanned yet.</p>
      }
    </section>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
      max-width: 44rem;
    }

    .scan {
      display: flex;
      align-items: flex-end;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .stats {
      padding: 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg-subtle);
      font-size: 0.9375rem;
    }

    .stats strong { font-size: 1.5rem; margin-right: 0.35rem; }
    .stats span { color: var(--text-muted); margin-left: 0.35rem; }

    .search { display: grid; gap: 0.5rem; margin-top: 1.5rem; }
    .search-row { display: flex; gap: 0.75rem; }
    .search input { flex: 1; min-width: 0; font: inherit; padding: 0.6875rem 0.875rem; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
    .results { list-style: none; margin: 0.75rem 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); }
    .results li { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 1rem; }
    .results li + li { border-top: 1px solid var(--border); }
    .results span { display: block; color: var(--text-muted); font-size: 0.8125rem; margin-top: 0.2rem; }
    .status-message { color: var(--text-muted); font-size: 0.875rem; }

    .scan .field {
      flex: 1 1 14rem;
      margin-bottom: 0;
    }

    .scan input {
      width: 100%;
      font: inherit;
      padding: 0.6875rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
    }

    .verdict {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.9375rem;
    }

    .verdict.ok {
      background: var(--success-bg);
      color: var(--success-fg);
    }

    .verdict.warn {
      background: var(--warn-bg);
      color: var(--warn-fg);
    }

    .verdict.bad {
      background: #fdeceb;
      color: #8c1d18;
    }

    h2 {
      margin-top: 2rem;
      font-size: 1.125rem;
    }

    .log {
      list-style: none;
      margin: 0.75rem 0 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .log li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
    }

    .log li + li {
      border-top: 1px solid var(--border);
    }

    .code {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .at,
    .empty {
      color: var(--text-muted);
    }

    .empty {
      margin-top: 0.75rem;
      font-size: 0.875rem;
    }
  `,
})
export class Checkin {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  private readonly eventId = Number(this.route.snapshot.paramMap.get('eventId'));

  protected readonly scans = signal<readonly ScanResult[]>([]);
  protected readonly last = signal<ScanResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly stats = signal<CheckInStats | null>(null);
  protected readonly searchResults = signal<readonly SearchResult[]>([]);
  protected readonly searchMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required]],
  });
  protected readonly searchForm = this.fb.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });

  constructor() {
    timer(0, 10000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadStats());
  }

  protected scan(): void {
    this.scanCode(this.form.controls.code.value);
    this.form.reset();
  }

  protected scanCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      return;
    }
    if (!Number.isInteger(this.eventId)) {
      return;
    }
    this.busy.set(true);
    this.api.post<ScanResult>('ticket', `/events/${this.eventId}/check-ins`, {
      code,
      helperEmail: this.auth.user()?.email ?? '',
    }).subscribe({
      next: (result) => this.record(result),
      error: () => {
        this.record({ code, outcome: 'unknown', at: timestamp() });
        this.busy.set(false);
      },
      complete: () => this.busy.set(false),
    });
  }

  protected search(): void {
    const query = this.searchForm.controls.query.value.trim();
    if (!query || !Number.isInteger(this.eventId)) {
      return;
    }
    this.busy.set(true);
    this.api.get<readonly SearchResult[]>('ticket', `/events/${this.eventId}/tickets/search?q=${encodeURIComponent(query)}`).subscribe({
      next: (results) => {
        this.searchResults.set(results);
        this.searchMessage.set(results.length ? null : 'No tickets found for this event.');
      },
      error: () => {
        this.searchMessage.set('Ticket search is unavailable. Try again.');
        this.busy.set(false);
      },
      complete: () => this.busy.set(false),
    });
  }

  private loadStats(): void {
    if (!Number.isInteger(this.eventId)) {
      return;
    }
    this.api.get<CheckInStats>('ticket', `/events/${this.eventId}/check-in-stats`).subscribe({
      next: (stats) => this.stats.set(stats),
    });
  }

  private record(result: ScanResult): void {
    this.scans.update((scans) => [result, ...scans]);
    this.last.set(result);
    this.loadStats();
  }

  protected describe(result: ScanResult): string {
    switch (result.outcome) {
      case 'admitted':
        return `${result.code} admitted`;
      case 'duplicate':
        return `${result.code} was already scanned`;
      case 'wrong_event':
        return `${result.code} belongs to another event`;
      default:
        return `${result.code} is not a valid ticket`;
    }
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}
