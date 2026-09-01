import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../core/api';
import { EventListing } from '../../core/catalog';
import { ROLE_LABELS, UserRole } from '../../core/roles';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

type StaffRole = Extract<UserRole, 'organiser' | 'event-helper'>;

interface TeamMember {
  readonly customerId: number;
  readonly name: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly addedAt: string;
}

/** Roles an organiser can grant a teammate for one event. */
const ASSIGNABLE_ROLES: readonly StaffRole[] = ['organiser', 'event-helper'];

type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';
type TeamStatus = 'loading' | 'ready' | 'error';

/**
 * Grants organiser or event-helper access to one event.
 *
 * The browser never touches Cognito directly here — this calls the event
 * service, which records the grant in `customer_event_roles`. There is no
 * self-service role picker anywhere else in the app; this page is the only
 * way anyone but the event's creator gets staff access to it.
 */
@Component({
  selector: 'app-event-team',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="organiser">
      <section class="page-head">
        <div class="shell">
          <p class="eyebrow">Organiser</p>
          <h1>Event team</h1>
          <p class="lead">Add admins and event helpers to manage this event.</p>
        </div>
      </section>

      <section class="shell body">
        @switch (status()) {
          @case ('loading') {
            <p class="status-message" role="status">Loading event…</p>
          }
          @case ('error') {
            <p class="status-message error" role="alert">
              Couldn't load this event.
              <button type="button" class="retry" (click)="loadEvent()">Try again</button>
            </p>
          }
          @case ('not-found') {
            <p class="not-found">
              That event could not be found. <a routerLink="/organiser">Back to your events</a>.
            </p>
          }
          @case ('ready') {
            @if (event(); as event) {
              <p class="for-event">For <strong>{{ event.title }}</strong></p>

              <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
                <h2>Add team member</h2>

                @if (addError()) {
                  <p class="form-error-banner" role="alert">{{ addError() }}</p>
                }

                <div class="field">
                  <label for="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    formControlName="email"
                    placeholder="jamie@onestage.io"
                    [attr.aria-invalid]="invalid()"
                  />
                  @if (invalid()) {
                    <p class="field-error">Enter a valid email address.</p>
                  }
                </div>

                <div class="field">
                  <label for="role">Role</label>
                  <select id="role" formControlName="role">
                    @for (role of roles; track role) {
                      <option [value]="role">{{ labels[role] }}</option>
                    }
                  </select>
                </div>

                <div class="actions">
                  <button type="button" class="btn btn-ghost" (click)="form.reset({ role: 'event-helper' })">
                    Clear
                  </button>
                  <button type="submit" class="btn btn-primary" [disabled]="adding()">
                    {{ adding() ? 'Adding…' : 'Add member' }}
                  </button>
                </div>
              </form>

              <h2 class="section-title">Current team</h2>
              @switch (teamStatus()) {
                @case ('loading') {
                  <p class="status-message" role="status">Loading team…</p>
                }
                @case ('error') {
                  <p class="status-message error" role="alert">
                    Couldn't load the team.
                    <button type="button" class="retry" (click)="loadTeam()">Try again</button>
                  </p>
                }
                @case ('ready') {
                  <div class="table-card">
                    <table>
                      <caption class="visually-hidden">
                        Team for {{ event.title }}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Email</th>
                          <th scope="col">Role</th>
                          <th scope="col">Added</th>
                          <th scope="col"><span class="visually-hidden">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (member of team(); track member.customerId) {
                          <tr>
                            <th scope="row">{{ member.name }}</th>
                            <td><a [href]="'mailto:' + member.email">{{ member.email }}</a></td>
                            <td>
                              <span class="pill role" [class.admin]="member.role === 'organiser'">
                                {{ labels[member.role] }}
                              </span>
                            </td>
                            <td>{{ member.addedAt | date: 'dd MMM y' }}</td>
                            <td class="actions-cell">
                              <button type="button" class="btn btn-ghost btn-sm" (click)="remove(member)">
                                Remove
                              </button>
                            </td>
                          </tr>
                        } @empty {
                          <tr>
                            <td colspan="5" class="empty">No admins or helpers on this event yet.</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              }

              <p class="note">Adding or removing team members updates access immediately.</p>
            }
          }
        }
      </section>
    </app-workspace-shell>
  `,
  styles: `
    .body {
      padding-block: clamp(2rem, 5vw, 3rem);
      max-width: 44rem;
    }

    .for-event {
      color: var(--text-muted);
      font-size: 0.9375rem;
      margin-bottom: 1.25rem;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg);
      padding: clamp(1.25rem, 3vw, 2rem);
      margin-bottom: 1.5rem;
    }

    h2 {
      font-size: 1.125rem;
      margin: 0 0 1rem;
    }

    .section-title {
      margin-top: 0.5rem;
    }

    select {
      font: inherit;
      font-size: 0.9375rem;
      padding: 0.6875rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--bg);
      color: var(--text);
      width: 100%;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .table-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      background: var(--bg);
    }

    table {
      width: 100%;
      min-width: 34rem;
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

    .role {
      background: var(--muted-bg);
      color: var(--muted-fg);
    }

    .role.admin {
      background: var(--brand-soft);
      color: var(--brand-600);
    }

    .actions-cell {
      text-align: right;
    }

    .empty {
      color: var(--text-muted);
    }

    .note {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .not-found {
      color: var(--text-muted);
    }

    .not-found a {
      color: var(--brand-600);
    }
  `,
})
export class EventTeam {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly roles = ASSIGNABLE_ROLES;
  protected readonly labels = ROLE_LABELS;

  /** Bound from the `:id` route segment (see `withComponentInputBinding`). */
  readonly id = input('');

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly event = signal<EventListing | null>(null);

  protected readonly teamStatus = signal<TeamStatus>('loading');
  protected readonly team = signal<readonly TeamMember[]>([]);

  protected readonly adding = signal(false);
  protected readonly addError = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['event-helper' as StaffRole, Validators.required],
  });

  constructor() {
    effect(() => {
      const eventId = this.id();
      if (eventId) {
        this.loadEvent();
      }
    });
  }

  protected invalid(): boolean {
    const email = this.form.controls.email;
    return email.invalid && email.touched;
  }

  protected loadEvent(): void {
    this.status.set('loading');
    this.api.get<EventListing>('event', `/events/${this.id()}`).subscribe({
      next: (event) => {
        this.event.set(event);
        this.status.set('ready');
        this.loadTeam();
      },
      error: (err: HttpErrorResponse) => this.status.set(err.status === 404 ? 'not-found' : 'error'),
    });
  }

  protected loadTeam(): void {
    this.teamStatus.set('loading');
    this.api.get<TeamMember[]>('event', `/events/${this.id()}/staff`).subscribe({
      next: (team) => {
        this.team.set(team);
        this.teamStatus.set('ready');
      },
      error: () => this.teamStatus.set('error'),
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.addError.set('');
    this.adding.set(true);
    const { email, role } = this.form.getRawValue();

    this.api.post('event', `/events/${this.id()}/staff`, { email, role }).subscribe({
      next: () => {
        this.adding.set(false);
        this.form.reset({ role: 'event-helper' });
        this.loadTeam();
      },
      error: () => {
        this.adding.set(false);
        this.addError.set('Could not add that team member. Try again.');
      },
    });
  }

  protected remove(member: TeamMember): void {
    this.api.delete('event', `/events/${this.id()}/staff/${member.customerId}`).subscribe({
      next: () => this.team.update((members) => members.filter((m) => m.customerId !== member.customerId)),
      error: () => this.teamStatus.set('error'),
    });
  }
}
