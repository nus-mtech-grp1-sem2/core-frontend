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

import { ApiService } from '../../../core/api';
import { QueueService, QueueStatus, QueueSummary } from '../../../core/queue';
import { WorkspaceShell } from '../../../layout/components/workspace-shell/workspace-shell';

type QueueState =
  'joining' | 'waiting' | 'admitted' | 'leaving' | 'left' | 'closed' | 'unavailable' | 'error';

/** Server refusals that mean the queue cannot be used, keyed by the API's error code. */
const UNAVAILABLE_MESSAGES: Readonly<Record<string, string>> = {
  event_not_on_sale: 'Tickets for this event are not currently on sale.',
  event_completed: 'This event has already taken place, so tickets are no longer on sale.',
};

interface EventNameResponse {
  readonly event: { readonly title: string };
}

/** Per-event customer queue. MySQL status is refreshed every three seconds. */
@Component({
  selector: 'app-event-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WorkspaceShell],
  templateUrl: './event-queue.html',
  styleUrl: './event-queue.css',
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
      await this.router.navigate(['/events']);
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
      try {
        const summary = await this.queue.summary(eventId);
        this.summary.set(summary);
        if (summary.status === 'CLOSED') {
          this.state.set('closed');
          return;
        }
        if (summary.status === 'DRAINED') {
          this.returnToEventsSoldOut();
          return;
        }
      } catch (error) {
        if (!isQueueNotConfigured(error)) throw error;
      }
      // The first customer creates the queue session; there is no organiser
      // "open" step anymore.
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
      void this.router.navigate(['/events', eventId, 'tickets']);
      return;
    }
    if (status.status === 'IN_CHECKOUT') {
      this.polling?.unsubscribe();
      void this.router.navigate(['/my-events']);
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
      this.returnToEventsSoldOut();
      return;
    }
    const unavailable = code ? UNAVAILABLE_MESSAGES[code] : undefined;
    if (unavailable) {
      this.message.set(unavailable);
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
      this.eventTitle.set('Event queue');
    }
  }

  private returnToEventsSoldOut(): void {
    this.polling?.unsubscribe();
    void this.router.navigate(['/events'], {
      queryParams: { availability: 'sold-out' },
      replaceUrl: true,
    });
  }
}

function isQueueNotConfigured(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 404 &&
    (error.error as { error?: string } | null)?.error === 'queue_not_configured'
  );
}
