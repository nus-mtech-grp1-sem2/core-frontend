import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { Home } from './home';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders every venue image with an API src and alt text', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: Array.from({ length: 9 }, (_, index) => ({ venue: `Venue ${index}`, upcoming: 1, sample_event_id: index + 1 })) });
    await fixture.whenStable();
    fixture.detectChanges();
    const images = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
    ) as HTMLImageElement[];

    expect(images.length).toBe(9);
    for (const img of images) {
      expect(img.getAttribute('src')).toMatch(/^\/api\/event\/events\/\d+\/image$/);
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(0);
    }
    httpMock.verify();
  });

  it('keeps sign-up marketing out of the way of a signed-in customer', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    // Signed out: the pitch is the point.
    expect(host.querySelector('.assurances')).not.toBeNull();
    expect(host.querySelector('.cta')).not.toBeNull();
    httpMock.verify();
  });
});
