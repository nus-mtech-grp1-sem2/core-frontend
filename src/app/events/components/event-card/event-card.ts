import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ManagedEvent } from '../../event.models';

@Component({
  selector: 'li[app-event-card]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink],
  templateUrl: './event-card.html',
  styleUrl: './event-card.css',
  host: { class: 'event-card' },
})
export class EventCard {
  readonly event = input.required<ManagedEvent>();
  readonly isAdmin = input(false);
  readonly completed = input(false);
  readonly detailLink = input.required<string | readonly (string | number)[]>();
  /** The organiser's uploaded photo, from the `event` service's image endpoint.
   * Not a static asset, so it's a plain `<img [src]>` with an `(error)` fallback
   * rather than `NgOptimizedImage` (which this repo reserves for bundled images). */
  readonly imageUrl = input.required<string>();
  readonly publish = output<number>();
  readonly delete = output<number>();
  readonly cancel = output<number>();

  protected useFallbackImage(target: EventTarget | null): void {
    if (target instanceof HTMLImageElement) target.src = 'images/hero-concert.jpg';
  }

  protected readonly statusLabel = computed(() => {
    if (this.completed()) return 'Completed';
    return this.event().status === 'PUBLISHED'
      ? 'On sale'
      : this.event().status === 'DRAFT'
        ? 'Draft'
        : 'Cancelled';
  });
  protected readonly tierLabel = computed(() =>
    this.event().tier === 'TIER1_GA' ? 'General admission' : 'Reserved seating',
  );
  protected readonly priceLabel = computed(
    () => '$' + ((this.event().price_cents ?? 0) / 100).toFixed(2),
  );
}
