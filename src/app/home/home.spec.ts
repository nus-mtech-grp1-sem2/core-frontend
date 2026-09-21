import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser } from '../core/cognito-gateway';
import { Home } from './home';

const authUser = signal<AuthenticatedUser | null>(null);
const authenticated = signal(false);
const authStub = {
  user: authUser.asReadonly(),
  status: computed(() => (authenticated() ? 'authenticated' : 'anonymous')),
  isAuthenticated: computed(() => authenticated()),
  signOut: async () => undefined,
};

describe('Home', () => {
  beforeEach(async () => {
    authenticated.set(false);
    authUser.set(null);
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authStub },
      ],
    }).compileComponents();
  });

  it('renders every venue with bundled artwork and alt text', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({
      venues: Array.from({ length: 9 }, (_, index) => ({
        venue: `Venue ${index}`,
        upcoming: 1,
        sample_event_id: index + 1,
      })),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const images = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
    ) as HTMLImageElement[];

    expect(images.length).toBe(6);
    const sources = new Set(images.map((image) => image.getAttribute('src')));
    expect(sources.size).toBe(6);
    for (const img of images) {
      expect(img.getAttribute('src')).toContain('images/venue-');
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(0);
    }
    httpMock.verify();
  });

  it('shows the product story to a signed-out visitor', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    // Signed out: the pitch is the point.
    expect(host.querySelector('.assurances')).not.toBeNull();
    expect(host.querySelector('#about-heading')?.textContent).toContain('One place');
    expect(host.querySelectorAll('.feature-grid li').length).toBe(4);
    expect(host.querySelector('.cta')).not.toBeNull();
    httpMock.verify();
  });

  it('shows a paid purchase while its ticket is still being issued', async () => {
    authenticated.set(true);
    authUser.set({ sub: 'customer-1', email: 'customer@example.com', name: '', groups: [] });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    httpMock.expectOne('/api/ticket/customers/me/tickets').flush({ tickets: [] });
    httpMock.expectOne('/api/order/customers/me/orders').flush({
      orders: [
        {
          order_id: 17,
          event_id: 172,
          status: 'PAID',
          event_title: 'Postman Tier 2 Test',
          venue: 'Test Theatre',
          starts_at: '2027-02-11T04:00:00.000Z',
          ticket_count: 2,
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Postman Tier 2 Test');
    expect(text).toContain('2 tickets');
    expect(text).toContain('Payment received · issuing ticket');
    httpMock.verify();
  });

  it('shows an unpaid reservation on the default route and allows cancellation', async () => {
    authenticated.set(true);
    authUser.set({ sub: 'customer-1', email: 'customer@example.com', name: '', groups: [] });
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    httpMock.expectOne('/api/event/events').flush({ events: [] });
    httpMock.expectOne('/api/event/venues').flush({ venues: [] });
    httpMock.expectOne('/api/ticket/customers/me/tickets').flush({ tickets: [] });
    httpMock.expectOne('/api/order/customers/me/orders').flush({
      orders: [
        {
          order_id: 42,
          event_id: 172,
          status: 'PENDING',
          event_title: 'Reserved show',
          venue: 'Test Theatre',
          starts_at: '2027-02-11T04:00:00.000Z',
          ticket_count: 2,
          created_at: new Date(Date.now() - 1_000).toISOString(),
          reservation_expires_at: new Date(Date.now() + 180_000).toISOString(),
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const reservation = (fixture.nativeElement as HTMLElement).querySelector(
      '.active-reservations',
    );
    expect(reservation?.textContent).toContain('Reserved show');
    expect(reservation?.textContent).toContain('Continue to payment');
    expect(reservation?.querySelector('a')?.getAttribute('href')).toBe('/checkout/42');

    reservation?.querySelector<HTMLButtonElement>('button')?.click();
    const cancel = httpMock.expectOne('/api/order/orders/42/cancel');
    expect(cancel.request.body).toEqual({});
    cancel.flush(null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.active-reservations')).toBeNull();
    httpMock.verify();
  });
});
