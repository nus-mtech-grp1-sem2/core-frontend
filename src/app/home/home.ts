import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../core/auth';
import { MY_ORDERS, TICKETS, VENUES } from '../core/catalog';
import { TicketTable } from '../tickets/ticket-table/ticket-table';
import { Carousel } from './carousel/carousel';

/** Landing page: featured carousel, venue grid and available tickets. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Carousel, NgOptimizedImage, RouterLink, TicketTable],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly auth = inject(AuthService);
  protected readonly orders = MY_ORDERS;

  /** First part of the email, which is the closest thing to a name we hold. */
  protected readonly firstName = computed(() => this.auth.user()?.email.split('@')[0] ?? '');

  protected readonly venues = VENUES;

  /** A short taste of what is on sale; the full list with filters is /tickets. */
  protected readonly featuredTickets = TICKETS.slice(0, 5);

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
