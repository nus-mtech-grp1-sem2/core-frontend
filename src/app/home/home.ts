import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventListing, FeaturedSlide, Order, TicketRow, Venue } from '../core/catalog';
import { PurchaseService } from '../core/purchase';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';
import { TicketTable } from '../tickets/ticket-table/ticket-table';
import { Carousel } from './carousel/carousel';

/** Landing page: featured carousel, venue grid and available tickets. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Carousel, NgOptimizedImage, RouterLink, TicketTable, WorkspaceShell],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly purchases = inject(PurchaseService);
  protected readonly orders = signal<readonly Order[]>([]);

  /** First part of the email, which is the closest thing to a name we hold. */
  protected readonly firstName = computed(() => this.auth.user()?.email.split('@')[0] ?? '');

  protected readonly venues = signal<readonly Venue[]>([]);
  protected readonly featuredSlides = signal<readonly FeaturedSlide[]>([]);

  /** A short taste of what is on sale; the full list with filters is /tickets. */
  protected readonly featuredTickets = signal<readonly TicketRow[]>([]);

  constructor() {
    this.api.get<EventListing[]>('event', '/events').subscribe({
      next: (events) => this.featuredSlides.set(
        events.filter((event) => event.featured).map((event) => ({
          id: event.id,
          category: event.category,
          title: event.title,
          subtitle: event.description || `${event.title} at ${event.venue}`,
          venue: event.venue,
          date: `${event.date} · ${event.time}`,
          priceFrom: `S$${event.priceFrom}`,
          image: event.image,
          alt: event.alt,
        })),
      ),
      error: () => this.featuredSlides.set([]),
    });
    this.api.get<Venue[]>('event', '/venues').subscribe({
      next: (venues) => this.venues.set(venues), error: () => this.venues.set([]),
    });
    this.api.get<TicketRow[]>('ticket', '/tickets').subscribe({
      next: (tickets) => this.featuredTickets.set(tickets.slice(0, 5)),
      error: () => this.featuredTickets.set([]),
    });
    effect(() => {
      const email = this.auth.user()?.email;
      if (!email) { this.orders.set([]); return; }
      this.api.get<Order[]>('order', `/orders?email=${encodeURIComponent(email)}`).subscribe({
        next: (orders) => this.orders.set(orders), error: () => this.orders.set([]),
      });
    });
  }

  protected readonly assurances = [
    {
      title: 'Verified tickets',
      detail: 'Every listing is issued and validated by the venue, never resold twice.',
    },
    {
      title: 'Fair queue',
      detail: 'A single waiting room per on-sale, so bots do not get ahead of you.',
    },
    {
      title: 'Instant delivery',
      detail: 'Mobile tickets land in your account the moment payment clears.',
    },
  ] as const;

  /** Signed-out visitors go to sign in first; checkout itself isn't built yet. */
  protected buy(ticket: TicketRow): void {
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
