import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { interval, startWith, switchMap } from 'rxjs';

import { QueueService, QueueStatus } from '../../core/queue';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

type QueueState = 'joining' | 'waiting' | 'admitted' | 'left' | 'error';

/** Waiting room for a Tier 2 event: join, poll position, get bounced back once admitted. */
@Component({
  selector: 'app-event-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, WorkspaceShell],
  template: `
    <app-workspace-shell workspace="customer">
    <section class="shell body queue">
      @switch (state()) {
        @case ('joining') {
          <p class="status-message" role="status">Joining the queue…</p>
        }
        @case ('waiting') {
          <h1>You're in the queue</h1>
          <p class="position">Position {{ position() ?? '—' }}</p>
          <p>Hang tight — we'll take you to the event the moment it's your turn.</p>
        }
        @case ('admitted') {
          <p class="status-message" role="status">You're in! Taking you to the event…</p>
        }
        @case ('left') {
          <h1>Your queue spot expired</h1>
          <button type="button" class="btn btn-primary" (click)="retry()">Rejoin the queue</button>
        }
        @case ('error') {
          <h1>Couldn't join the queue</h1>
          <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
        }
      }
      <a class="back" routerLink="/events">Back to all events</a>
    </section>
    </app-workspace-shell>
  `,
  styles: `
    .queue {
      padding-block: clamp(3rem, 8vw, 5rem);
      max-width: 32rem;
      text-align: center;
      display: grid;
      justify-items: center;
      gap: 0.75rem;
    }

    .position {
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .back {
      margin-top: 1rem;
      font-size: 0.875rem;
      color: var(--brand-600);
    }
  `,
})
export class EventQueue {
  private readonly queue = inject(QueueService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input('');
  protected readonly state = signal<QueueState>('joining');
  protected readonly position = signal<number | null>(null);

  constructor() {
    void this.start();
  }

  protected retry(): void {
    void this.start();
  }

  private async start(): Promise<void> {
    const eventId = Number(this.id());
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      this.state.set('error');
      return;
    }

    this.state.set('joining');
    try {
      const joined = await this.queue.join(eventId);
      this.apply(joined);
      if (joined.status === 'WAITING') {
        this.poll(eventId);
      }
    } catch {
      this.state.set('error');
    }
  }

  private poll(eventId: number): void {
    interval(3000)
      .pipe(
        startWith(0),
        switchMap(() => this.queue.status(eventId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (status) => this.apply(status),
        error: () => this.state.set('error'),
      });
  }

  private apply(status: QueueStatus): void {
    this.position.set(status.position ?? null);
    if (status.status === 'ADMITTED') {
      this.state.set('admitted');
      void this.router.navigate(['/events', this.id()]);
    } else if (status.status === 'EXPIRED' || status.status === 'LEFT') {
      this.state.set('left');
    } else {
      this.state.set('waiting');
    }
  }
}
