import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../core/auth';
import { EVENTS, EventCategory, EventListing } from '../core/catalog';

type Filter = 'All' | EventCategory;

/** Browse page listing every upcoming event, filterable by category. */
@Component({
  selector: 'app-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, NgOptimizedImage, RouterLink, ReactiveFormsModule],
  templateUrl: './events.html',
  styleUrl: './events.css',
})
export class Events {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly filters: readonly Filter[] = ['All', 'Concerts', 'Sports', 'Theatre'];
  protected readonly activeFilter = signal<Filter>('All');

  /** Admin-only maintenance: local copy so New/Delete don't mutate the shared sample data. */
  private readonly allEvents = signal<readonly EventListing[]>(EVENTS);

  protected readonly isAdmin = computed(() => this.auth.hasRole('organiser'));
  protected readonly showNewEventForm = signal(false);

  protected readonly newEventForm = this.fb.group({
    title: this.fb.control('', Validators.required),
    category: this.fb.control<EventCategory>('Concerts', Validators.required),
    venue: this.fb.control('', Validators.required),
    date: this.fb.control('', Validators.required),
    time: this.fb.control('', Validators.required),
    priceFrom: this.fb.control(0, [Validators.required, Validators.min(0)]),
    totalCapacity: this.fb.control(0, [Validators.required, Validators.min(1)]),
    ticketType: this.fb.control('Standard', Validators.required),
  });

  protected readonly events = computed(() => {
    const filter = this.activeFilter();
    const all = this.allEvents();
    return filter === 'All' ? all : all.filter((event) => event.category === filter);
  });

  protected setFilter(filter: Filter): void {
    this.activeFilter.set(filter);
  }

  protected toggleNewEventForm(): void {
    this.showNewEventForm.update((open) => !open);
  }

  /** Adds the event to this session's listing only; not wired to the event service yet. */
  protected addEvent(): void {
    if (this.newEventForm.invalid) {
      this.newEventForm.markAllAsTouched();
      return;
    }

    const value = this.newEventForm.getRawValue();
    const nextId = this.allEvents().reduce((max, event) => Math.max(max, event.id), 0) + 1;

    const created: EventListing = {
      id: nextId,
      title: value.title,
      category: value.category,
      venue: value.venue,
      date: value.date,
      time: value.time,
      priceFrom: value.priceFrom,
      totalCapacity: value.totalCapacity,
      ticketType: value.ticketType,
      image: 'images/hero-concert.jpg',
      alt: `${value.title} artwork`,
      status: 'On sale',
    };

    this.allEvents.update((events) => [...events, created]);
    this.newEventForm.reset({ title: '', category: 'Concerts', venue: '', date: '', time: '', priceFrom: 0, totalCapacity: 0, ticketType: 'Standard' });
    this.showNewEventForm.set(false);
  }

  /** Removes the event from this session's listing only; not wired to the event service yet. */
  protected deleteEvent(id: number): void {
    this.allEvents.update((events) => events.filter((event) => event.id !== id));
  }
}

