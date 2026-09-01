import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { EventListing } from '../../core/catalog';
import { PurchaseService } from '../../core/purchase';
import { WorkspaceShell } from '../../layout/workspace-shell/workspace-shell';

interface EventTicketType {
  readonly id: string;
  readonly section: string;
  readonly price: number;
  readonly status: 'On sale' | 'Few left' | 'Sold out';
}

type EventDetailDto = EventListing & { ticketTypes: readonly EventTicketType[] };
type LoadStatus = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * One event's own page: its details plus every ticket type sold for it.
 * Reached from an event card on `/events` or a carousel slide — never a
 * flat, unfiltered ticket marketplace (that's `/tickets`).
 */
@Component({
  selector: 'app-event-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, NgOptimizedImage, RouterLink, WorkspaceShell],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.css',
})
export class EventDetail {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly purchases = inject(PurchaseService);

  /** Bound from the `:id` route segment (see `withComponentInputBinding`). */
  readonly id = input('');

  protected readonly status = signal<LoadStatus>('loading');
  protected readonly event = signal<EventDetailDto | null>(null);

  constructor() {
    effect(() => {
      const eventId = this.id();
      if (!eventId) {
        return;
      }
      this.load(eventId);
    });
  }

  protected load(eventId: string): void {
    this.status.set('loading');
    this.api.get<EventDetailDto>('event', `/events/${eventId}`).subscribe({
      next: (event) => {
        this.event.set(event);
        this.status.set('ready');
      },
      error: (err: HttpErrorResponse) => {
        this.status.set(err.status === 404 ? 'not-found' : 'error');
      },
    });
  }

  /** Signed-out visitors go to sign in first; checkout itself isn't built yet. */
  protected buy(ticket: EventTicketType): void {
    if (!this.auth.isAuthenticated()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    this.purchases.buy(ticket.id).subscribe({
      next: () => void this.router.navigateByUrl('/my-events'),
      error: () => window.alert('The ticket could not be purchased. It may no longer be available.'),
    });
  }
}
