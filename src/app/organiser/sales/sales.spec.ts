import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth';
import { Sales } from './sales';

describe('Sales', () => {
  it('combines managed events with current order-service sales summaries', async () => {
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [
        {
          event_id: 7,
          title: 'Postman Order Test',
          venue: 'Test Hall',
          total_seats: 10,
          remaining_qty: 6,
          status: 'PUBLISHED',
        },
      ],
    });
    await Promise.resolve();

    http.expectOne('/api/order/events/7/orders/summary').flush({
      paidOrders: 2,
      ticketsSold: 4,
      revenueCents: 20_000,
      averageOrderCents: 10_000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Postman Order Test');
    expect(text).toContain('Test Hall');
    expect(text).toContain('4 / 10');
    expect(text).toContain('S$200');
    expect(text).toContain('S$100');
    expect(text).not.toContain("Couldn't load sales figures");
    http.verify();
  });

  it('keeps the event visible when its sales summary is temporarily unavailable', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Sales],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Sales);
    fixture.detectChanges();

    http.expectOne('/api/event/events/manage').flush({
      events: [
        {
          event_id: 8,
          title: 'No Orders Yet',
          venue: 'Test Hall',
          total_seats: 20,
          remaining_qty: 20,
          status: 'PUBLISHED',
        },
      ],
    });
    await Promise.resolve();
    http
      .expectOne('/api/order/events/8/orders/summary')
      .flush({ error: 'temporary_failure' }, { status: 502, statusText: 'Bad Gateway' });
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No Orders Yet');
    expect(text).toContain('0 / 20');
    expect(text).not.toContain("Couldn't load sales figures");
    http.verify();
  });
});
