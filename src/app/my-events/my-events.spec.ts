import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api';
import { MyEvents } from './my-events';

describe('MyEvents', () => {
  it('excludes tickets and orders for events where the account is on the event team', async () => {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/customers/me/tickets') {
        return of({
          tickets: [
            {
              ticket_id: 1,
              order_id: 10,
              event_id: 172,
              event_title: 'Team event',
              venue: 'Test Hall',
              starts_at: '2026-09-20 20:00:00',
              seat_label: 'A1',
              qr_token: 'team-event-ticket',
              status: 'ISSUED',
            },
          ],
        });
      }
      if (path === '/customers/me/orders') {
        return of({
          orders: [
            {
              order_id: 11,
              event_id: 172,
              status: 'PAID',
              total_amount_cents: 2_000,
              currency: 'SGD',
              paid_at: '2026-09-19 10:00:00',
              event_title: 'Team event',
              venue: 'Test Hall',
              starts_at: '2026-09-20 20:00:00',
              ticket_count: 1,
            },
          ],
        });
      }
      if (path === '/helper/shifts') return of({ events: [{ event_id: 172 }] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [MyEvents],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: ApiService, useValue: { get } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MyEvents);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Team event');
    expect(text).toContain('No tickets yet');
    expect(get).toHaveBeenCalledWith('event', '/helper/shifts');
  });
});
