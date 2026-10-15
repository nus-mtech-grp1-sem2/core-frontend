import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../../../core/api';
import { AuthService } from '../../../core/auth';
import { QueueService, QueueStatus } from '../../../core/queue';
import { QueuePlacesService } from '../../../core/queue-places';
import { ActiveQueuePlaces } from './active-queue-places';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class EmptyPage {}

describe('ActiveQueuePlaces', () => {
  const user = signal<{ sub: string } | null>({ sub: 'customer' });
  const activePlaces = signal<{ eventId: number; entry: QueueStatus }[]>([]);
  let fixture: ComponentFixture<ActiveQueuePlaces>;
  let host: HTMLElement;
  let queue: {
    activePlaces: typeof activePlaces;
    leave: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    clearAll: ReturnType<typeof vi.fn>;
  };

  const admitted = (eventId: number, seconds = 600): { eventId: number; entry: QueueStatus } => ({
    eventId,
    entry: {
      queueEntryId: eventId,
      status: 'ADMITTED',
      admissionToken: `private-token-${eventId}`,
      tokenExpiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    },
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    sessionStorage.clear();
    user.set({ sub: 'customer' });
    activePlaces.set([]);
    queue = {
      activePlaces,
      leave: vi.fn(async (eventId: number) => {
        activePlaces.update((places) => places.filter((place) => place.eventId !== eventId));
      }),
      status: vi.fn().mockResolvedValue({ status: 'WAITING' }),
      clear: vi.fn(),
      clearAll: vi.fn(() => activePlaces.set([])),
    };
    await TestBed.configureTestingModule({
      imports: [ActiveQueuePlaces],
      providers: [
        provideRouter([{ path: '**', component: EmptyPage }]),
        { provide: QueueService, useValue: queue },
        { provide: AuthService, useValue: { user, isAuthenticated: () => user() !== null } },
        {
          provide: ApiService,
          useValue: {
            get: (_service: string, path: string) =>
              of({ event: { title: path.endsWith('/7') ? 'Summer Concert' : 'Autumn Concert' } }),
          },
        },
      ],
    }).compileComponents();
    TestBed.runInInjectionContext(() => TestBed.inject(QueuePlacesService).start());
    fixture = TestBed.createComponent(ActiveQueuePlaces);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  }

  async function navigate(url: string): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(url);
    await render();
  }

  it('stacks independent event names, countdowns and return links without exposing tokens', async () => {
    activePlaces.set([admitted(7, 600), admitted(8, 180)]);
    await navigate('/events');
    expect(host.querySelectorAll('.place-card')).toHaveLength(2);
    expect(host.textContent).toContain('2 active');
    expect(host.querySelectorAll('h3')[0].textContent).toBe('Summer Concert');
    expect(host.querySelectorAll('h3')[1].textContent).toBe('Autumn Concert');
    expect(Array.from(host.querySelectorAll('.countdown'), (el) => el.textContent)).toEqual([
      '10:00',
      '3:00',
    ]);
    expect(host.querySelectorAll('a')[0].getAttribute('href')).toBe('/events/7/tickets');
    expect(host.querySelectorAll('a')[1].getAttribute('href')).toBe('/events/8/tickets');
    expect(host.innerHTML).not.toContain('private-token');
    await vi.advanceTimersByTimeAsync(1000);
    await render();
    expect(Array.from(host.querySelectorAll('.countdown'), (el) => el.textContent)).toEqual([
      '9:59',
      '2:59',
    ]);
  });

  it('releases only the selected event and stays on the current page', async () => {
    activePlaces.set([admitted(7), admitted(8)]);
    await navigate('/my-events');
    host.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(queue.leave).toHaveBeenCalledExactlyOnceWith(7);
    expect(host.querySelectorAll('.place-card')).toHaveLength(1);
    expect(host.textContent).toContain('Autumn Concert');
    expect(TestBed.inject(Router).url).toBe('/my-events');
  });

  it('preserves both places and offers retry when releasing fails', async () => {
    activePlaces.set([admitted(7), admitted(8)]);
    queue.leave.mockRejectedValue(new Error('offline'));
    await render();
    host.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(host.querySelectorAll('.place-card')).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Please try again');
    expect(host.querySelector('button')?.disabled).toBe(false);
  });

  it('hides the stack on queue, ticket-selection and payment pages without releasing any places', async () => {
    activePlaces.set([admitted(7), admitted(8)]);
    for (const path of ['/events/7/queue', '/events/7/tickets', '/checkout/42']) {
      await navigate(path);
      expect(host.querySelector('section')).toBeNull();
    }
    await navigate('/events');
    expect(host.querySelectorAll('.place-card')).toHaveLength(2);
    expect(queue.leave).not.toHaveBeenCalled();
  });

  it('shows waiting positions, polls off-page places and switches to ticket links on admission', async () => {
    activePlaces.set([{ eventId: 7, entry: { queueEntryId: 7, status: 'WAITING', position: 4 } }]);
    await render();
    expect(host.textContent).toContain('Position 4');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/events/7/queue');
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.status).toHaveBeenCalledWith(7);
    activePlaces.set([admitted(7)]);
    await render();
    expect(host.textContent).toContain('It is your turn.');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/events/7/tickets');
  });

  it('removes expired admissions independently without resetting another countdown', async () => {
    activePlaces.set([admitted(7, 1), admitted(8, 120)]);
    await render();
    await vi.advanceTimersByTimeAsync(1000);
    await render();
    expect(host.querySelectorAll('.place-card')).toHaveLength(1);
    expect(host.textContent).toContain('Autumn Concert');
    expect(host.querySelector('.countdown')?.textContent).toBe('1:59');
  });

  it('hides places on non-customer pages and does not poll there', async () => {
    activePlaces.set([admitted(7)]);
    for (const path of ['/organiser/events', '/helper', '/login']) {
      await navigate(path);
      expect(host.querySelector('section')).toBeNull();
    }
    await vi.advanceTimersByTimeAsync(6000);
    expect(queue.status).not.toHaveBeenCalled();
    await navigate('/my-events');
    expect(host.querySelectorAll('.place-card')).toHaveLength(1);
  });

  it('forgets places when signing out or switching accounts', async () => {
    activePlaces.set([admitted(7)]);
    await render();
    user.set(null);
    await render();
    expect(queue.clearAll).toHaveBeenCalledOnce();
    expect(host.querySelector('section')).toBeNull();
    user.set({ sub: 'another-customer' });
    await render();
    expect(host.querySelector('section')).toBeNull();
  });

  it('remembers event IDs only and restores fresh server status for the signed-in account', async () => {
    activePlaces.set([admitted(7)]);
    await render();
    expect(sessionStorage.getItem('onestage:queue-places:customer')).toBe('[7]');
    expect(sessionStorage.getItem('onestage:queue-places:customer')).not.toContain('private-token');
    user.set(null);
    await render();
    expect(sessionStorage.getItem('onestage:queue-places:customer')).toBeNull();
    sessionStorage.setItem('onestage:queue-places:another-customer', '[8]');
    queue.status.mockImplementation(async (eventId: number) => {
      activePlaces.set([admitted(eventId)]);
      return activePlaces()[0].entry;
    });
    user.set({ sub: 'another-customer' });
    await render();
    await render();
    expect(queue.status).toHaveBeenCalledWith(8);
    expect(host.textContent).toContain('Autumn Concert');
    expect(host.textContent).not.toContain('Summer Concert');
  });

  it('clears retained metadata before the hosted sign-out redirect and does not rewrite empty entries', async () => {
    activePlaces.set([admitted(7)]);
    await render();
    expect(sessionStorage.getItem('onestage:queue-places:customer')).toBe('[7]');
    TestBed.inject(QueuePlacesService).forgetLocalPlaces();
    await render();
    expect(sessionStorage.getItem('onestage:queue-places:customer')).toBeNull();
    expect(host.querySelector('section')).toBeNull();
    expect(queue.clearAll).toHaveBeenCalledOnce();
  });

  it('keeps places through temporary polling errors but clears a missing server entry', async () => {
    activePlaces.set([admitted(7)]);
    queue.status.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.clear).not.toHaveBeenCalled();
    queue.status.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(queue.clear).toHaveBeenCalledExactlyOnceWith(7);
  });
});
