import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EventListing } from '../core/catalog';
import { Events } from './events';

const MOCK_EVENTS: readonly EventListing[] = [
  { id: 1, title: 'Neon Skyline Tour', category: 'Concerts', venue: 'Marina Bay Arena', date: 'Fri 12 Sep 2026', time: '8:00 PM', priceFrom: 88, image: 'images/hero-concert.jpg', alt: 'a', status: 'On sale' },
  { id: 2, title: 'ASEAN Cup Final', category: 'Sports', venue: 'Kallang Grand Stadium', date: 'Mon 28 Sep 2026', time: '5:00 PM', priceFrom: 45, image: 'images/hero-stadium.jpg', alt: 'b', status: 'On sale' },
  { id: 3, title: 'Midnight at the Esplanade', category: 'Theatre', venue: 'Bayfront Concert Hall', date: 'Sat 10 Oct 2026', time: '8:30 PM', priceFrom: 65, image: 'images/hero-theatre.jpg', alt: 'c', status: 'Few left' },
  { id: 4, title: 'Marina Jazz Nights', category: 'Concerts', venue: 'Clarke Quay Live House', date: 'Sat 19 Sep 2026', time: '7:30 PM', priceFrom: 60, image: 'images/venue-livehouse.jpg', alt: 'd', status: 'Few left' },
  { id: 5, title: 'Indie Weekender', category: 'Concerts', venue: 'Sentosa Open Air', date: 'Sun 04 Oct 2026', time: '6:00 PM', priceFrom: 95, image: 'images/venue-openair.jpg', alt: 'e', status: 'Sold out' },
  { id: 6, title: 'Island Derby', category: 'Sports', venue: 'Kallang Grand Stadium', date: 'Sat 17 Oct 2026', time: '7:45 PM', priceFrom: 78, image: 'images/venue-stadium.jpg', alt: 'f', status: 'On sale' },
  { id: 7, title: 'Late Night Improv', category: 'Theatre', venue: 'Clarke Quay Live House', date: 'Fri 23 Oct 2026', time: '10:00 PM', priceFrom: 45, image: 'images/venue-theatre.jpg', alt: 'g', status: 'On sale' },
  { id: 8, title: 'Harbour Lights Festival', category: 'Concerts', venue: 'Jurong Festival Grounds', date: 'Sat 31 Oct 2026', time: '4:00 PM', priceFrom: 130, image: 'images/venue-festival.jpg', alt: 'h', status: 'On sale' },
];

describe('Events', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Events],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists every event with artwork and a price', async () => {
    const fixture = TestBed.createComponent(Events);
    httpMock.expectOne('/api/event/events').flush(MOCK_EVENTS);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.event-card').length).toBe(8);
    expect(host.querySelectorAll('.event-card img').length).toBe(8);
    expect(host.querySelector('.from-price')?.textContent).toContain('S$');
  });

  it('filters the grid by category', async () => {
    const fixture = TestBed.createComponent(Events);
    httpMock.expectOne('/api/event/events').flush(MOCK_EVENTS);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const theatre = Array.from(host.querySelectorAll<HTMLButtonElement>('.chip')).find(
      (chip) => chip.textContent?.trim() === 'Theatre',
    );
    theatre?.click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.event-card').length).toBe(2);
    expect(host.querySelector('.count')?.textContent).toContain('2 events');
  });
});
