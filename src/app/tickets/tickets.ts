import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { EventCategory, TicketRow } from '../core/catalog';
import { PurchaseService } from '../core/purchase';
import { WorkspaceShell } from '../layout/workspace-shell/workspace-shell';
import { TicketTable } from './ticket-table/ticket-table';

type Filter = 'All' | EventCategory;
type Sort = 'date' | 'price-asc' | 'price-desc';
type LoadStatus = 'loading' | 'ready' | 'error';

/** Full ticket listing with category filtering, sorting and availability toggle. */
@Component({
  selector: 'app-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TicketTable, WorkspaceShell],
  templateUrl: './tickets.html',
  styleUrl: './tickets.css',
})
export class Tickets {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly purchases = inject(PurchaseService);

  protected readonly filters: readonly Filter[] = ['All', 'Concerts', 'Sports', 'Theatre'];

  protected readonly activeFilter = signal<Filter>('All');
  protected readonly sort = signal<Sort>('date');
  protected readonly availableOnly = signal(false);

  protected readonly status = signal<LoadStatus>('loading');
  private readonly allTickets = signal<readonly TicketRow[]>([]);

  protected readonly tickets = computed<readonly TicketRow[]>(() => {
    const filter = this.activeFilter();
    const rows = this.allTickets().filter(
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
        // The service already returns rows in event-date order.
        return rows;
    }
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.status.set('loading');
    this.api.get<TicketRow[]>('ticket', '/tickets').subscribe({
      next: (tickets) => {
        this.allTickets.set(tickets);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }

  protected setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  protected setSort(value: string): void {
    this.sort.set(value as Sort);
  }

  protected toggleAvailableOnly(checked: boolean): void {
    this.availableOnly.set(checked);
  }

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
