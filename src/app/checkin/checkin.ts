import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AuthService } from '../core/auth';
import { ApiService } from '../core/api';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

interface ScanResult {
  readonly code: string;
  readonly outcome: 'admitted' | 'duplicate' | 'unknown';
  readonly at: string;
}

/**
 * Door workspace for event helpers: enter a ticket code and admit the holder.
 * Validation and duplicate detection are persisted by the ticket service.
 */
@Component({
  selector: 'app-checkin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="event-helper">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Event helper</p>
          <h1>Door check-in</h1>
          <p class="lead">Signed in as {{ auth.user()?.email }}.</p>
        </div>
      </section>

      <section class="shell body">
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
          <button class="btn btn-primary" type="submit">Check in</button>
        </form>

        @if (last(); as result) {
          <p
            class="verdict"
            role="status"
            [class.ok]="result.outcome === 'admitted'"
            [class.warn]="result.outcome === 'duplicate'"
            [class.bad]="result.outcome === 'unknown'"
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
    </app-workspace-shell>
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
  protected readonly auth = inject(AuthService);

  protected readonly scans = signal<readonly ScanResult[]>([]);
  protected readonly last = signal<ScanResult | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required]],
  });

  protected scan(): void {
    const code = this.form.controls.code.value.trim().toUpperCase();
    if (!code) {
      return;
    }

    this.api.post<{ code: string; outcome: ScanResult['outcome']; at: string }>('ticket', '/check-ins', {
      code,
      helperEmail: this.auth.user()?.email ?? '',
    }).subscribe({
      next: (response) => this.record({ ...response, at: timestamp(response.at) }),
      error: (error: { status?: number }) => {
        if (error.status === 404) this.record({ code, outcome: 'unknown', at: timestamp() });
      },
    });
  }

  protected describe(result: ScanResult): string {
    switch (result.outcome) {
      case 'admitted':
        return `${result.code} admitted`;
      case 'duplicate':
        return `${result.code} was already scanned`;
      default:
        return `${result.code} is not a valid ticket`;
    }
  }

  private record(result: ScanResult): void {
    this.scans.update((scans) => [result, ...scans]);
    this.last.set(result);
    this.form.reset();
  }
}

function timestamp(value?: string): string {
  return new Date(value ?? Date.now()).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}
