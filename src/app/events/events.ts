import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EVENTS, EventCategory } from '../core/catalog';

type Filter = 'All' | EventCategory;

/** Browse page listing every upcoming event, filterable by category. */
@Component({
  selector: 'app-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, NgOptimizedImage, RouterLink],
  templateUrl: './events.html',
  styleUrl: './events.css',
})
export class Events {
  protected readonly filters: readonly Filter[] = ['All', 'Concerts', 'Sports', 'Theatre'];
  protected readonly activeFilter = signal<Filter>('All');

  protected readonly events = computed(() => {
    const filter = this.activeFilter();
    return filter === 'All' ? EVENTS : EVENTS.filter((event) => event.category === filter);
  });

  protected setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }
}
