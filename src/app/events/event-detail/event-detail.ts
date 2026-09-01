import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { ATTENDEES, EVENTS, TICKETS, TicketRow } from '../../core/catalog';

/**
 * One event's own page: its details plus every ticket type sold for it.
 * Reached from an event card on `/events` or a carousel slide — never a
 * flat, unfiltered ticket marketplace (that's `/tickets`).
 *
 * Event helpers see who has bought tickets for the event instead of the
 * ticket types and buy buttons, since they are not shopping — they are
 * checking who to expect at the door.
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

  protected readonly isHelper = computed(() => this.auth.hasRole('event-helper'));

  protected readonly event = computed(() => {
    const eventId = Number(this.id());
    return EVENTS.find((event) => event.id === eventId) ?? null;
  });

  protected readonly ticketTypes = computed(() => {
    const eventId = Number(this.id());
    return TICKETS.filter((ticket) => ticket.eventId === eventId);
  });

  protected readonly attendees = computed(() => {
    const eventId = Number(this.id());
    return ATTENDEES.filter((attendee) => attendee.eventId === eventId);
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
