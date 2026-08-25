import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { EVENTS, TICKETS, TicketRow } from '../../core/catalog';

/**
 * One event's own page: its details plus every ticket type sold for it.
 * Reached from an event card on `/events` or a carousel slide — never a
 * flat, unfiltered ticket marketplace (that's `/tickets`).
 */
@Component({
  selector: 'app-event-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, NgOptimizedImage, RouterLink],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.css',
})
export class EventDetail {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Bound from the `:id` route segment (see `withComponentInputBinding`). */
  readonly id = input('');

  protected readonly event = computed(() => {
    const eventId = Number(this.id());
    return EVENTS.find((event) => event.id === eventId) ?? null;
  });

  protected readonly ticketTypes = computed(() => {
    const eventId = Number(this.id());
    return TICKETS.filter((ticket) => ticket.eventId === eventId);
  });

  /** Signed-out visitors go to sign in first; checkout itself isn't built yet. */
  protected buy(ticket: TicketRow): void {
    if (!this.auth.isAuthenticated()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    console.info('Checkout is not wired up yet.', ticket);
  }
}
