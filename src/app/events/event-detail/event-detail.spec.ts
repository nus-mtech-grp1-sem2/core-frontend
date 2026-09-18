import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { EventDetail, purchaseErrorMessage } from './event-detail';

describe('EventDetail purchase errors', () => {
  it('explains an inventory conflict instead of showing a generic failure', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { error: 'inventory_unavailable' },
    });

    expect(purchaseErrorMessage(error)).toContain('unavailable or sold out');
  });

  it('explains that an event-team member cannot purchase', () => {
    const error = new HttpErrorResponse({
      status: 403,
      error: { error: 'event_team_cannot_purchase' },
    });

    expect(purchaseErrorMessage(error)).toContain('Organisers and event helpers cannot purchase');
  });
});

describe('EventDetail event-team purchase restriction', () => {
  it('does not render purchase controls for an accepted event helper', async () => {
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: '2026-09-20 20:00:00',
            total_seats: 10,
            available_buyers: 2,
            tier: 'TIER1_GA',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/helper/shifts') return of({ events: [{ event_id: 172 }] });
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { workspace: 'customer' } } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'helper-sub',
              email: 'helper@example.com',
              name: 'Helper',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put: vi.fn(), post: vi.fn(), delete: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('cannot purchase tickets for events they manage');
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Buy tickets',
      ),
    ).toBe(false);
  });
});

describe('EventDetail waiting-room controls', () => {
  it('opens the waiting room and manually admits a waiting customer', async () => {
    let queueLoads = 0;
    const get = vi.fn((_service: string, path: string): Observable<unknown> => {
      if (path === '/events/172') {
        return of({
          event: {
            event_id: 172,
            organiser_sub: 'owner-sub',
            title: 'Test event',
            description: 'Description',
            venue: 'Test Hall',
            starts_at: '2026-09-20 20:00:00',
            total_seats: 10,
            available_buyers: 2,
            tier: 'TIER2_SEATED',
            status: 'PUBLISHED',
            price_cents: 2_000,
          },
        });
      }
      if (path === '/events/172/team-members') return of({ members: [] });
      if (path === '/events/172/seats') return of({ seats: [] });
      if (path === '/events/172/queue') {
        queueLoads += 1;
        if (queueLoads === 1) {
          return throwError(() => new HttpErrorResponse({ status: 404 }));
        }
        return of({
          queue: {
            eventId: 172,
            admissionBatchSize: 2,
            status: 'OPEN',
            waitingCount: queueLoads === 2 ? 1 : 0,
          },
        });
      }
      return throwError(() => new Error(`Unexpected GET ${path}`));
    });
    const put = vi.fn(() => of({ queueSession: { status: 'OPEN' } }));
    const post = vi.fn(() => of({ admitted: 1, remaining: 0 }));

    await TestBed.configureTestingModule({
      imports: [EventDetail],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { workspace: 'organiser' } } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              sub: 'owner-sub',
              email: 'owner@example.com',
              name: 'Owner',
              groups: [],
            }),
            isAuthenticated: () => true,
          },
        },
        { provide: ApiService, useValue: { get, put, post, delete: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventDetail);
    fixture.componentRef.setInput('id', '172');
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const buttons = () =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      );
    buttons()
      .find((button) => button.textContent?.trim() === 'Open waiting room')
      ?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(put).toHaveBeenCalledWith('queue', '/events/172/queue/config', {
      opensAt: expect.any(String),
      admissionBatchSize: 2,
      admissionIntervalSec: 60,
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The waiting room is open',
    );

    buttons()
      .find((button) => button.textContent?.trim() === 'Admit next customer')
      ?.click();
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('queue', '/events/172/queue/admit-next', {});
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('1 customer admitted.');
  });
});
