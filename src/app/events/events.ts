import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api';
import { EventCategory, EventListing } from '../core/catalog';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';

type Filter = 'All' | EventCategory;
type LoadStatus = 'loading' | 'ready' | 'error';

/** Browse page listing every upcoming event, filterable by category. */
@Component({
  selector: 'app-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, NgOptimizedImage, RouterLink, WorkspaceShell],
  templateUrl: './events.html',
  styleUrl: './events.css',
})
export class Events {
  private readonly api = inject(ApiService);

  protected readonly filters: readonly Filter[] = ['All', 'Concerts', 'Sports', 'Theatre'];
  protected readonly activeFilter = signal<Filter>('All');

  protected readonly status = signal<LoadStatus>('loading');
  private readonly allEvents = signal<readonly EventListing[]>([]);

  protected readonly events = computed(() => {
    const filter = this.activeFilter();
    const all = this.allEvents();
    return filter === 'All' ? all : all.filter((event) => event.category === filter);
  });

  constructor() {
    this.load();
  }

  protected setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  protected load(): void {
    this.status.set('loading');
    this.api.get<EventListing[]>('event', '/events').subscribe({
      next: (events) => {
        this.allEvents.set(events);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }
}
