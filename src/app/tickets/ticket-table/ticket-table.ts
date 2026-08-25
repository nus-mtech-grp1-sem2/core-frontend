import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { TicketRow } from '../../core/catalog';

/**
 * Presentational table of ticket listings, shared by the home and tickets
 * pages. Emits `buy` rather than acting itself — whether that means "go to
 * login" or "start checkout" depends on the caller's auth state.
 */
@Component({
  selector: 'app-ticket-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  templateUrl: './ticket-table.html',
  styleUrl: './ticket-table.css',
})
export class TicketTable {
  readonly tickets = input.required<readonly TicketRow[]>();
  readonly caption = input('Tickets currently on sale');
  readonly buy = output<TicketRow>();
}
