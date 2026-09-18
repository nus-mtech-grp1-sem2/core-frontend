import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth';
import { Attendees } from './attendees';

describe('Attendees', () => {
  it('loads managed events and maps the current order-service attendee response', async () => {
    await TestBed.configureTestingModule({
      imports: [Attendees],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Attendees);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [{ event_id: 7, title: 'Postman Order Test' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectOne('/api/order/events/7/attendees').flush({
      attendees: [
        {
          order_id: 16,
          customer_email: 'buyer@example.com',
          paid_at: '2027-02-11T04:00:00.000Z',
          description: 'General Admission',
          quantity: 2,
          seat_id: null,
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Postman Order Test');
    expect(text).toContain('buyer@example.com');
    expect(text).toContain('General Admission');
    expect(text).toContain('2');
    expect(text).not.toContain("Couldn't load attendees");
    http.verify();
  });
});
