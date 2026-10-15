import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { QueueService } from './queue';

describe('QueueService', () => {
  let queue: QueueService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    queue = TestBed.inject(QueueService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('keeps admission tokens scoped to their event', async () => {
    const eventOne = queue.join(1);
    http.expectOne('/api/queue/events/1/queue/join').flush({
      queueEntryId: 11,
      status: 'ADMITTED',
      admissionToken: 'event-one-token',
      tokenExpiresAt: '2026-09-16T12:10:00.000Z',
    });
    await eventOne;

    const eventTwo = queue.join(2);
    http.expectOne('/api/queue/events/2/queue/join').flush({
      queueEntryId: 22,
      status: 'WAITING',
      position: 4,
    });
    await eventTwo;

    expect(queue.admissionTokenFor(1)).toBe('event-one-token');
    expect(queue.admissionTokenFor(2)).toBeNull();
  });

  it('clears only the completed event', async () => {
    const admitted = queue.join(1);
    http.expectOne('/api/queue/events/1/queue/join').flush({
      queueEntryId: 11,
      status: 'ADMITTED',
      admissionToken: 'event-one-token',
    });
    await admitted;

    queue.clear(1);

    expect(queue.statusFor(1)).toBeNull();
  });

  it('leaves an event queue and clears its saved admission', async () => {
    const admitted = queue.join(7);
    http.expectOne('/api/queue/events/7/queue/join').flush({
      queueEntryId: 77,
      status: 'ADMITTED',
      admissionToken: 'event-seven-token',
      tokenExpiresAt: '2026-09-16T12:10:00.000Z',
    });
    await admitted;

    const leaving = queue.leave(7);
    const request = http.expectOne('/api/queue/events/7/queue/me');
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await leaving;

    expect(queue.statusFor(7)).toBeNull();
    expect(queue.admissionTokenFor(7)).toBeNull();
  });

  it('retains multiple active places and removes only the one entering checkout', async () => {
    for (const eventId of [7, 8]) {
      const joined = queue.join(eventId);
      http.expectOne(`/api/queue/events/${eventId}/queue/join`).flush({
        queueEntryId: eventId,
        status: 'ADMITTED',
        admissionToken: `token-${eventId}`,
      });
      await joined;
    }
    expect(queue.activePlaces().map((place) => place.eventId)).toEqual([7, 8]);
    queue.markInCheckout(7);
    expect(queue.activePlaces().map((place) => place.eventId)).toEqual([8]);
    expect(queue.statusFor(7)?.status).toBe('IN_CHECKOUT');
    expect(queue.admissionTokenFor(7)).toBeNull();
    expect(queue.admissionTokenFor(8)).toBe('token-8');
  });

  it.each(['release', 'checkout', 'account-change'] as const)(
    'does not restore an admission from a late poll after %s',
    async (action) => {
      const joined = queue.join(7);
      const admitted = { queueEntryId: 7, status: 'ADMITTED', admissionToken: 'private-token' };
      http.expectOne('/api/queue/events/7/queue/join').flush(admitted);
      await joined;
      const polling = queue.status(7);
      const pending = http.expectOne('/api/queue/events/7/queue/me');
      if (action === 'release') {
        const leaving = queue.leave(7);
        http.expectOne('/api/queue/events/7/queue/me').flush(null);
        await leaving;
      } else if (action === 'checkout') {
        queue.markInCheckout(7);
      } else {
        queue.clearAll();
      }
      pending.flush(admitted);
      await polling;
      expect(queue.activePlaces()).toEqual([]);
      expect(queue.admissionTokenFor(7)).toBeNull();
    },
  );
});
