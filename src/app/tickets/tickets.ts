import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { EventCategory, TICKETS, TicketRow } from '../core/catalog';
import { TicketTable } from './ticket-table/ticket-table';

type Filter = 'All' | EventCategory;
type Sort = 'date' | 'price-asc' | 'price-desc';

/** Full ticket listing with category filtering, sorting and availability toggle. */
@Component({
  selector: 'app-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TicketTable],
  templateUrl: './tickets.html',
  styleUrl: './tickets.css',
})
export class Tickets {
  protected readonly filters: readonly Filter[] = ['All', 'Concerts', 'Sports', 'Theatre'];

  protected readonly activeFilter = signal<Filter>('All');
  protected readonly sort = signal<Sort>('date');
  protected readonly availableOnly = signal(false);

  protected readonly tickets = computed<readonly TicketRow[]>(() => {
    const filter = this.activeFilter();
    const rows = TICKETS.filter(
      (ticket) =>
        (filter === 'All' || ticket.category === filter) &&
        (!this.availableOnly() || ticket.status !== 'Sold out'),
    );

    switch (this.sort()) {
      case 'price-asc':
        return [...rows].sort((a, b) => a.price - b.price);
      case 'price-desc':
        return [...rows].sort((a, b) => b.price - a.price);
      default:
        // The sample data is already in event-date order.
        return rows;
    }
  });

  protected setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  protected setSort(value: string): void {
    this.sort.set(value as Sort);
  }

  protected toggleAvailableOnly(checked: boolean): void {
    this.availableOnly.set(checked);
  }
}
