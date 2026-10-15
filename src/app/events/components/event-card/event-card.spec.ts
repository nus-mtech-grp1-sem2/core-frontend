import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ManagedEvent } from '../../event.models';
import { EventCard } from './event-card';

const EVENT: ManagedEvent = {
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

function renderEvent(overrides: Partial<ManagedEvent> = {}): HTMLElement {
  TestBed.configureTestingModule({
    imports: [EventCard],
    providers: [provideRouter([])],
  });

  const fixture = TestBed.createComponent(EventCard);
  fixture.componentRef.setInput('event', { ...EVENT, ...overrides });
  fixture.componentRef.setInput('detailLink', ['/events', 1]);
  fixture.componentRef.setInput('imageUrl', 'images/hero-concert.jpg');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('EventCard', () => {
  it("shows the Singapore wall-clock start time, regardless of the viewer's own timezone", () => {
    const text = renderEvent().textContent ?? '';
    expect(text).toContain('6 Oct 2026, 8:00 PM');
  });

  it.each([
    ['general-admission', 'TIER1_GA'],
    ['reserved-seating', 'TIER2_SEATED'],
  ] as const)('sends %s customers directly to the queue', (_label, tier) => {
    const host = renderEvent({ tier });

    const action = host.querySelector<HTMLAnchorElement>('.customer-action a');
    expect(action?.textContent?.trim()).toBe('Buy ticket');
    expect(action?.getAttribute('href')).toBe('/events/1/queue');
  });
});
