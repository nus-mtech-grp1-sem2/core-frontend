import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Subscription, exhaustMap, firstValueFrom, from, timer } from 'rxjs';

import { ApiService } from '../../core/api';
import { QueueService, QueueStatus, QueueSummary } from '../../core/queue';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

type QueueState =
  | 'joining'
  | 'waiting'
  | 'admitted'
  | 'leaving'
  | 'left'
  | 'closed'
  | 'sold-out'
  | 'unavailable'
  | 'error';

interface EventNameResponse {
  readonly event: { readonly title: string };
}

/** Per-event customer waiting room. MySQL status is refreshed every three seconds. */
@Component({
  selector: 'app-event-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="customer">
      <main class="shell body queue" aria-labelledby="queue-heading">
        <p class="eyebrow">Waiting room</p>
        <h1 id="queue-heading">{{ eventTitle() || 'Event waiting room' }}</h1>

        @switch (state()) {
          @case ('joining') {
            <div class="loader" aria-hidden="true"></div>
            <p class="status-message" role="status">Checking your queue place…</p>
          }
          @case ('waiting') {
            <p class="position" aria-live="polite">
              <span>Position</span>
              <strong>{{ position() ?? '—' }}</strong>
            </p>
            <p>You can keep this page open. Your position refreshes automatically.</p>
            <button type="button" class="btn btn-ghost" (click)="leave()">Leave queue</button>
          }
          @case ('admitted') {
            <p class="status-message success" role="status">
              It’s your turn. Opening seat selection…
            </p>
          }
          @case ('leaving') {
            <p class="status-message" role="status">Leaving the queue…</p>
          }
          @case ('left') {
            <h2>Your queue place is no longer active</h2>
            <p>Rejoin to receive a new position.</p>
            <button type="button" class="btn btn-primary" (click)="retry()">Rejoin queue</button>
          }
          @case ('closed') {
            <h2>The waiting room is not open yet</h2>
            @if (summary()?.opensAt; as opensAt) {
              <p>It opens {{ opensAt | date: 'EEE d MMM y, h:mm a' }}.</p>
            }
            <button type="button" class="btn btn-primary" (click)="retry()">Check again</button>
          }
          @case ('sold-out') {
            <h2>This queue has closed</h2>
            <p>There is no ticket inventory available for another admission batch.</p>
          }
          @case ('unavailable') {
            <h2>The waiting room is unavailable</h2>
            <p>{{ message() }}</p>
            <a class="btn btn-primary" [routerLink]="['/events', eventId()]">View event</a>
          }
          @case ('error') {
            <h2>We couldn’t update your queue place</h2>
            <p role="alert">{{ message() }}</p>
            <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
          }
        }

        <a class="back" [routerLink]="['/events', eventId()]">Back to event details</a>
      </main>
    </app-workspace-shell>
  `,
  styles: `
    .queue {
      max-width: 36rem;
      min-height: 30rem;
      padding-block: clamp(3rem, 8vw, 5rem);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.875rem;
    }

    .eyebrow {
      margin: 0;
    }
    h1 {
      font-size: clamp(1.75rem, 5vw, 2.5rem);
    }
    h2 {
      font-size: 1.25rem;
      margin-top: 0.5rem;
    }

    .position {
      display: grid;
      gap: 0.25rem;
      min-width: 10rem;
      padding: 1.25rem 2rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg);
      box-shadow: var(--shadow-sm);
    }

    .position span {
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    .position strong {
      font-size: 2.5rem;
      font-variant-numeric: tabular-nums;
    }
    .success {
      color: var(--success-fg);
    }

    .loader {
      width: 2rem;
      height: 2rem;
      border: 0.25rem solid var(--border);
      border-top-color: var(--brand-500);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .back {
      margin-top: 1rem;
      font-size: 0.875rem;
      color: var(--brand-600);
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .loader {
        animation: none;
      }
    }
  `,
})
export class EventQueue {
  private readonly api = inject(ApiService);
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private activeEventId: number | null = null;
  private polling: Subscription | null = null;

  readonly id = input('');
  protected readonly state = signal<QueueState>('joining');
  protected readonly position = signal<number | null>(null);
  protected readonly summary = signal<QueueSummary | null>(null);
  protected readonly eventTitle = signal('');
  protected readonly message = signal('Please try again.');
  protected readonly eventId = signal<number | null>(null);

  constructor() {
    effect(() => {
      const eventId = Number(this.id());
      if (!Number.isSafeInteger(eventId) || eventId <= 0) {
        if (this.id()) {
          this.message.set('This event link is invalid.');
          this.state.set('unavailable');
        }
        return;
      }
      if (eventId === this.activeEventId) return;
      this.activeEventId = eventId;
      this.eventId.set(eventId);
      void this.start(eventId);
    });
  }

  protected retry(): void {
    if (this.activeEventId !== null) void this.start(this.activeEventId);
  }

  protected async leave(): Promise<void> {
    if (this.activeEventId === null || this.state() !== 'waiting') return;
    this.polling?.unsubscribe();
    this.state.set('leaving');
    try {
      await this.queue.leave(this.activeEventId);
      this.position.set(null);
      this.state.set('left');
    } catch (error) {
      this.fail(error);
    }
  }

  private async start(eventId: number): Promise<void> {
    this.polling?.unsubscribe();
    this.state.set('joining');
    this.position.set(null);
    this.message.set('Please try again.');
    void this.loadEventName(eventId);

    try {
      const summary = await this.queue.summary(eventId);
      this.summary.set(summary);
      if (summary.status === 'CLOSED') {
        this.state.set('closed');
        return;
      }
      if (summary.status === 'DRAINED') {
        this.state.set('sold-out');
        return;
      }
      await this.queue.join(eventId);
      this.apply(eventId, await this.queue.status(eventId));
    } catch (error) {
      this.fail(error);
    }
  }

  private poll(eventId: number): void {
    this.polling?.unsubscribe();
    this.polling = timer(3000, 3000)
      .pipe(
        exhaustMap(() => from(this.queue.status(eventId))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (status) => this.apply(eventId, status),
        error: (error: unknown) => this.fail(error),
      });
  }

  private apply(eventId: number, status: QueueStatus): void {
    this.position.set(status.position ?? null);
    if (status.status === 'ADMITTED') {
      this.polling?.unsubscribe();
      this.state.set('admitted');
      void this.router.navigate(['/events', eventId]);
      return;
    }
    if (status.status === 'IN_CHECKOUT') {
      this.polling?.unsubscribe();
      void this.router.navigate(['/events', eventId]);
      return;
    }
    if (status.status === 'EXPIRED' || status.status === 'LEFT') {
      this.polling?.unsubscribe();
      this.state.set('left');
      return;
    }
    this.state.set('waiting');
    if (!this.polling || this.polling.closed) this.poll(eventId);
  }

  private fail(error: unknown): void {
    this.polling?.unsubscribe();
    const code =
      error instanceof HttpErrorResponse
        ? (error.error as { error?: string } | null)?.error
        : undefined;
    if (code === 'queue_not_open') {
      this.state.set('closed');
      return;
    }
    if (code === 'queue_drained') {
      this.state.set('sold-out');
      return;
    }
    if (code === 'queue_not_configured' || code === 'event_not_on_sale') {
      this.message.set(
        code === 'queue_not_configured'
          ? 'The organiser has not configured a waiting room for this event.'
          : 'Tickets for this event are not currently on sale.',
      );
      this.state.set('unavailable');
      return;
    }
    this.message.set('Check your connection and try again.');
    this.state.set('error');
  }

  private async loadEventName(eventId: number): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.api.get<EventNameResponse>('event', `/events/${eventId}`),
      );
      this.eventTitle.set(response.event.title);
    } catch {
      this.eventTitle.set('Event waiting room');
    }
  }
}
