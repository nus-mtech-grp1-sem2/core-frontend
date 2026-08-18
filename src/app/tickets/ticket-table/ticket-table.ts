import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TicketRow } from '../../core/catalog';

/** Presentational table of ticket listings, shared by the home and tickets pages. */
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
}
