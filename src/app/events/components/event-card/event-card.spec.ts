import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ManagedEvent } from '../../event.models';
import { EventCard } from './event-card';

describe('EventCard', () => {
  it("shows the Singapore wall-clock start time, regardless of the viewer's own timezone", () => {
    const event: ManagedEvent = {
      event_id: 1,
      title: 'Test Event',
      description: null,
      venue: 'NUS ISS',
      // 8pm Singapore time on 6 Oct 2026, expressed as its correct UTC instant.
      starts_at: '2026-10-06T12:00:00.000Z',
      total_seats: 100,
      available_buyers: null,
      tier: 'TIER1_GA',
      status: 'PUBLISHED',
      price_cents: null,
    };

    TestBed.configureTestingModule({
      imports: [EventCard],
      providers: [provideRouter([])],
    });

    const fixture = TestBed.createComponent(EventCard);
    fixture.componentRef.setInput('event', event);
    fixture.componentRef.setInput('detailLink', ['/events', 1]);
    fixture.componentRef.setInput('imageUrl', 'images/hero-concert.jpg');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('6 Oct 2026, 8:00 PM');
  });
});
