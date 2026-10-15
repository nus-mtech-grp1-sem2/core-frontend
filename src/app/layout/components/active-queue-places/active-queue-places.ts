import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { QueuePlacesService } from '../../../core/queue-places';

@Component({
  selector: 'app-active-queue-places',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './active-queue-places.html',
  styleUrl: './active-queue-places.css',
})
export class ActiveQueuePlaces {
  readonly reservationCount = input(0);
  readonly reservationError = input('');
  private readonly state = inject(QueuePlacesService);
  protected readonly places = this.state.places;
  protected readonly releasing = this.state.releasing;
  protected readonly errors = this.state.errors;

  protected release(eventId: number): void {
    void this.state.release(eventId);
  }
}
