import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { Events } from './events';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', name: 'Someone Example', groups };
}

const MOCK_EVENTS = [
  { event_id: 1, title: 'Neon Skyline Tour', description: null, venue: 'Marina Bay Arena', starts_at: '2026-09-12 20:00:00', total_seats: 500, available_buyers: null, tier: 'TIER1_GA', status: 'PUBLISHED', price_cents: 8800 },
  { event_id: 2, title: 'ASEAN Cup Final', description: null, venue: 'Kallang Grand Stadium', starts_at: '2026-09-28 17:00:00', total_seats: 2000, available_buyers: 25, tier: 'TIER2_SEATED', status: 'PUBLISHED', price_cents: 4500 },
] as const;

async function renderFor(current: AuthenticatedUser | null) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Events],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CognitoGateway,
        useValue: { currentUser: async () => current, signOut: async () => undefined },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: current?.groups.includes('organiser') ? { workspace: 'organiser' } : { workspace: 'customer' },
          },
        },
      },
    ],
  }).compileComponents();

  await TestBed.inject(AuthService).restore();
  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(Events);
  fixture.detectChanges();

  return { fixture, httpMock, host: fixture.nativeElement as HTMLElement };
}

describe('Events', () => {
  it('lists every event for a signed-out visitor, without organiser controls', async () => {
    const { fixture, httpMock, host } = await renderFor(null);

    httpMock.expectOne('/api/event/events').flush({ events: MOCK_EVENTS });
    await fixture.whenStable();
    fixture.detectChanges();
    for (const event of MOCK_EVENTS) {
      httpMock.expectOne(`/api/event/events/${event.event_id}`).flush({ event });
    }
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card').length).toBe(2);
    expect(host.textContent).toContain('Join waiting room');
    expect(host.textContent).toContain('View tickets');
    expect(host.textContent).not.toContain('New event');
    httpMock.verify();
  });

  it('lets an organiser open the new-event form', async () => {
    const { fixture, httpMock, host } = await renderFor(user(['organiser']));

    httpMock.expectOne('/api/event/events/manage').flush({ events: MOCK_EVENTS });
    httpMock.expectOne('/api/event/team-invitations').flush({ invitations: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelectorAll('.event-card').length).toBe(2);
    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'New event',
    );
    expect(toggle).toBeTruthy();

    toggle?.click();
    await fixture.whenStable();

    expect(host.querySelector('#event-title')).not.toBeNull();
    expect(host.querySelector('#event-available-buyers')).not.toBeNull();
    httpMock.verify();
  });
});
