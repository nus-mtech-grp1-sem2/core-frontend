import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventCategory, FeaturedSlide, Venue } from '../core/catalog';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';
import { Carousel } from './carousel/carousel';

type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'VOID';

/** One row of `GET /customers/me/tickets` — see `my-events.ts` for the full shape. */
interface UpcomingTicket {
  readonly ticket_id: number;
  readonly event_id: number;
  readonly event_title: string;
  readonly venue: string;
  readonly starts_at: string;
  readonly seat_label: string | null;
  readonly status: TicketStatus;
}

interface TicketsResponse {
  readonly tickets: readonly UpcomingTicket[];
}

interface VenueResponse {
  readonly venues: readonly Venue[];
}

interface EventApiRecord {
  readonly event_id: number;
  readonly title?: string;
  readonly event_name?: string;
  readonly description: string | null;
  readonly venue: string;
  readonly starts_at?: string;
  readonly event_start_datetime?: string;
  readonly tier?: 'TIER1_GA' | 'TIER2_SEATED';
  readonly event_type?: 'TIER1_GA' | 'TIER2_SEATED';
  readonly price_cents: number | null;
}

interface EventResponse {
  readonly events: readonly EventApiRecord[];
}

/** Landing page: featured carousel and venue grid. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Carousel, DatePipe, RouterLink, WorkspaceShell],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly tickets = signal<readonly UpcomingTicket[]>([]);

  /** First part of the email, which is the closest thing to a name we hold. */
  protected readonly firstName = computed(() => this.auth.user()?.email.split('@')[0] ?? '');

  protected readonly venues = signal<readonly Venue[]>([]);
  protected readonly featuredSlides = signal<readonly FeaturedSlide[]>([]);

  constructor() {
    this.api.get<EventResponse>('event', '/events').subscribe({
      next: (result) => this.featuredSlides.set(
        result.events.slice(0, 3).map((event) => {
          const title = event.title ?? event.event_name ?? '';
          const startsAt = event.starts_at ?? event.event_start_datetime ?? '';
          return {
            id: event.event_id,
            category: categoryFor(event, title),
            title,
            subtitle: event.description || `${title} at ${event.venue}`,
            venue: event.venue,
            date: formatEventDate(startsAt),
            priceFrom: `S$${((event.price_cents ?? 0) / 100).toFixed(0)}`,
            image: this.api.url('event', `/events/${event.event_id}/image`),
            alt: `${title} artwork`,
          };
        }),
      ),
      error: () => this.featuredSlides.set([]),
    });
    this.api.get<VenueResponse>('event', '/venues').subscribe({
      next: (result) => this.venues.set(result.venues),
      error: () => this.venues.set([]),
    });
    effect(() => {
      if (!this.auth.isAuthenticated()) {
        this.tickets.set([]);
        return;
      }
      this.api.get<TicketsResponse>('ticket', '/customers/me/tickets').subscribe({
        next: (result) => this.tickets.set(result.tickets.slice(0, 5)),
        error: () => this.tickets.set([]),
      });
    });
  }

  protected venueImageUrl(sampleEventId: number): string {
    return this.api.url('event', `/events/${sampleEventId}/image`);
  }

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/venue-arena.jpg';
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
}

function categoryFor(event: EventApiRecord, title: string): EventCategory {
  const text = `${title} ${event.venue}`.toLowerCase();
  const tier = event.tier ?? event.event_type;
  if (/cup|derby|stadium|match|football/.test(text)) return 'Sports';
  if (tier === 'TIER2_SEATED' || /theatre|comedy|improv/.test(text)) return 'Theatre';
  return 'Concerts';
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })}`;
}
