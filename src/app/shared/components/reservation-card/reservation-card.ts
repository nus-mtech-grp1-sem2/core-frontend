import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface ReservationSummary {
  readonly order_id: number;
  readonly event_title: string;
  readonly ticket_count: number;
}

@Component({
  selector: 'app-reservation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './reservation-card.html',
  styleUrl: './reservation-card.css',
})
export class ReservationCard {
  readonly order = input.required<ReservationSummary>();
  readonly timeRemaining = input('');
  readonly cancelling = input(false);
  readonly processing = input(false);
  readonly cancelRequested = output<void>();
}
