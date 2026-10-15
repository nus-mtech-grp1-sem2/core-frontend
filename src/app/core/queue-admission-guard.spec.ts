import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';

import { QueueService, QueueStatus } from './queue';
import { queueAdmissionGuard } from './queue-admission-guard';

describe('queueAdmissionGuard', () => {
  const status = vi.fn();

  beforeEach(() => {
    status.mockReset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: QueueService, useValue: { status } }],
    });
  });

  async function destination(id = '7') {
    const result = await TestBed.runInInjectionContext(() =>
      queueAdmissionGuard(
        { paramMap: convertToParamMap({ id }) } as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    );
    return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;
  }

  it('allows ticket selection with a live server admission', async () => {
    status.mockResolvedValue({
      queueEntryId: 71,
      status: 'ADMITTED',
      admissionToken: 'test-admission',
      tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    } satisfies QueueStatus);

    expect(await destination()).toBe(true);
    expect(status).toHaveBeenCalledWith(7);
  });

  it.each(['WAITING', 'LEFT', 'EXPIRED'] as const)(
    'sends a %s customer to the queue without showing event details',
    async (entryStatus) => {
      status.mockResolvedValue({ queueEntryId: 71, status: entryStatus });
      expect(await destination()).toBe('/events/7/queue');
    },
  );

  it('rejects an expired admission even if its status still says ADMITTED', async () => {
    status.mockResolvedValue({
      queueEntryId: 71,
      status: 'ADMITTED',
      admissionToken: 'expired-token',
      tokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(await destination()).toBe('/events/7/queue');
  });

  it('sends a customer already checking out to their pending payments', async () => {
    status.mockResolvedValue({ queueEntryId: 71, status: 'IN_CHECKOUT' });
    expect(await destination()).toBe('/my-events');
  });

  it('lets the queue page handle a missing entry or failed request', async () => {
    status.mockRejectedValue(new Error('Queue unavailable'));
    expect(await destination()).toBe('/events/7/queue');
  });

  it('returns invalid event links to all events without contacting the queue', async () => {
    expect(await destination('invalid')).toBe('/events');
    expect(status).not.toHaveBeenCalled();
  });
});
