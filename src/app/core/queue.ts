import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api';

export interface QueueStatus {
  readonly status: 'WAITING' | 'ADMITTED' | 'EXPIRED' | 'LEFT';
  readonly position?: number;
  readonly admissionToken?: string;
}

/**
 * Waiting-room state for Tier 2 (seated) events.
 *
 * Holds the admission token in memory once granted, so `EventDetail` can tell
 * whether a visitor already queued for the event they're looking at without
 * re-fetching queue status on every render.
 */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly api = inject(ApiService);
  private readonly _admissionToken = signal<string | null>(null);

  readonly admissionToken = this._admissionToken.asReadonly();

  join(eventId: number): Promise<QueueStatus> {
    return firstValueFrom(this.api.post<QueueStatus>('queue', `/events/${eventId}/queue/join`, {})).then(
      (status) => this.apply(status),
    );
  }

  status(eventId: number): Promise<QueueStatus> {
    return firstValueFrom(this.api.get<QueueStatus>('queue', `/events/${eventId}/queue/me`)).then((status) =>
      this.apply(status),
    );
  }

  /** Forgets the admission token — called once an order is placed, so a later purchase requires rejoining. */
  clear(): void {
    this._admissionToken.set(null);
  }

  private apply(status: QueueStatus): QueueStatus {
    if (status.status === 'ADMITTED' && status.admissionToken) {
      this._admissionToken.set(status.admissionToken);
    }
    return status;
  }
}
