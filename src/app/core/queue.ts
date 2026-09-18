import { Injectable, inject, signal } from '@angular/core';
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

/** Customer waiting-room state, isolated by event. */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly api = inject(ApiService);
  private readonly entries = signal<ReadonlyMap<number, QueueStatus>>(new Map());

  statusFor(eventId: number): QueueStatus | null {
    return this.entries().get(eventId) ?? null;
  }

  admissionTokenFor(eventId: number): string | null {
    const entry = this.statusFor(eventId);
    return entry?.status === 'ADMITTED' ? entry.admissionToken ?? null : null;
  }

  summary(eventId: number): Promise<QueueSummary> {
    return firstValueFrom(
      this.api.get<{ readonly queue: QueueSummary }>('queue', `/events/${eventId}/queue`),
    ).then((response) => response.queue);
  }

  join(eventId: number): Promise<QueueStatus> {
    return firstValueFrom(
      this.api.post<QueueStatus>('queue', `/events/${eventId}/queue/join`, {}),
    ).then((status) => this.apply(eventId, status));
  }

  status(eventId: number): Promise<QueueStatus> {
    return firstValueFrom(
      this.api.get<QueueStatus>('queue', `/events/${eventId}/queue/me`),
    ).then((status) => this.apply(eventId, status));
  }

  async leave(eventId: number): Promise<void> {
    await firstValueFrom(this.api.delete('queue', `/events/${eventId}/queue/me`));
    this.clear(eventId);
  }

  /** Forgets only this event's state after leaving or completing checkout. */
  clear(eventId: number): void {
    this.entries.update((current) => {
      const next = new Map(current);
      next.delete(eventId);
      return next;
    });
  }

  private apply(eventId: number, status: QueueStatus): QueueStatus {
    this.entries.update((current) => new Map(current).set(eventId, status));
    return status;
  }
}
