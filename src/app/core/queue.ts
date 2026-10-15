import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api';

export interface QueueStatus {
  readonly queueEntryId: number;
  readonly status: 'WAITING' | 'ADMITTED' | 'IN_CHECKOUT' | 'EXPIRED' | 'LEFT';
  readonly position?: number;
  readonly admissionToken?: string;
  readonly tokenExpiresAt?: string;
}

export interface QueueSummary {
  readonly eventId: number;
  readonly opensAt: string;
  readonly admissionBatchSize: number;
  readonly admissionIntervalSec: number;
  readonly status: 'CLOSED' | 'OPEN' | 'DRAINED';
  readonly waitingCount: number;
}

/** Customer queue state, isolated by event. */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly api = inject(ApiService);
  private readonly entries = signal<ReadonlyMap<number, QueueStatus>>(new Map());
  private readonly revisions = new Map<number, number>();
  private session = 0;

  readonly activePlaces = computed(() =>
    Array.from(this.entries(), ([eventId, entry]) => ({ eventId, entry })).filter(
      ({ entry }) => entry.status === 'WAITING' || entry.status === 'ADMITTED',
    ),
  );

  statusFor(eventId: number): QueueStatus | null {
    return this.entries().get(eventId) ?? null;
  }

  admissionTokenFor(eventId: number): string | null {
    const entry = this.statusFor(eventId);
    return entry?.status === 'ADMITTED' ? (entry.admissionToken ?? null) : null;
  }

  summary(eventId: number): Promise<QueueSummary> {
    return firstValueFrom(
      this.api.get<{ readonly queue: QueueSummary }>('queue', `/events/${eventId}/queue`),
    ).then((response) => response.queue);
  }

  join(eventId: number): Promise<QueueStatus> {
    const apply = this.responseHandler(eventId);
    return firstValueFrom(
      this.api.post<QueueStatus>('queue', `/events/${eventId}/queue/join`, {}),
    ).then(apply);
  }

  status(eventId: number): Promise<QueueStatus> {
    const apply = this.responseHandler(eventId);
    return firstValueFrom(this.api.get<QueueStatus>('queue', `/events/${eventId}/queue/me`)).then(
      apply,
    );
  }

  async leave(eventId: number): Promise<void> {
    const session = this.session;
    this.invalidate(eventId);
    await firstValueFrom(this.api.delete('queue', `/events/${eventId}/queue/me`));
    if (session === this.session) this.clear(eventId);
  }

  /** Forgets only this event's state after leaving or completing checkout. */
  clear(eventId: number): void {
    this.invalidate(eventId);
    this.entries.update((current) => {
      const next = new Map(current);
      next.delete(eventId);
      return next;
    });
  }

  markInCheckout(eventId: number): void {
    this.invalidate(eventId);
    const entry = this.statusFor(eventId);
    if (entry) {
      this.entries.update((current) =>
        new Map(current).set(eventId, { queueEntryId: entry.queueEntryId, status: 'IN_CHECKOUT' }),
      );
    }
  }

  /** Forget local state on account changes without releasing server-side places. */
  clearAll(): void {
    this.session++;
    this.revisions.clear();
    this.entries.set(new Map());
  }

  private invalidate(eventId: number): void {
    this.revisions.set(eventId, (this.revisions.get(eventId) ?? 0) + 1);
  }

  /** A late poll must not restore a released place or a previous account's state. */
  private responseHandler(eventId: number): (status: QueueStatus) => QueueStatus {
    const session = this.session;
    const revision = this.revisions.get(eventId);
    return (status) => {
      if (session === this.session && revision === this.revisions.get(eventId)) {
        this.entries.update((current) => new Map(current).set(eventId, status));
      }
      return status;
    };
  }
}
