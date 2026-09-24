import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../../../core/api';
import { AuthService } from '../../../core/auth';
import { QueueService, QueueStatus } from '../../../core/queue';
import { EventQueue } from './event-queue';

describe('EventQueue', () => {
  it('waits for the live queue position instead of flashing the original position', async () => {
    let resolveStatus!: (status: QueueStatus) => void;
    const liveStatus = new Promise<QueueStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const queue = {
      summary: vi.fn().mockResolvedValue({
        eventId: 7,
        opensAt: '2026-09-16T12:00:00.000Z',
        admissionBatchSize: 10,
        admissionIntervalSec: 30,
        status: 'OPEN',
        waitingCount: 3,
      }),
      join: vi.fn().mockResolvedValue({ queueEntryId: 71, status: 'WAITING', position: 20 }),
      status: vi.fn().mockReturnValue(liveStatus),
      leave: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [EventQueue],
      providers: [
        provideRouter([]),
        { provide: QueueService, useValue: queue },
        { provide: ApiService, useValue: { get: () => of({ event: { title: 'Test Event' } }) } },
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EventQueue);
    fixture.detectChanges();
    expect(queue.join).not.toHaveBeenCalled();

    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    await vi.waitFor(() => expect(queue.status).toHaveBeenCalledWith(7));
    fixture.detectChanges();

    expect(queue.summary).toHaveBeenCalledWith(7);
    expect(queue.join).toHaveBeenCalledWith(7);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Checking your queue place',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('20');

    resolveStatus({ queueEntryId: 71, status: 'WAITING', position: 2 });
    await Promise.resolve();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Position');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('2');
    fixture.destroy();
  });

  describe('when the server refuses the join', () => {
    async function renderRefused(error: HttpErrorResponse) {
      const queue = {
        summary: vi.fn().mockResolvedValue({
          eventId: 7,
          opensAt: '2026-09-16T12:00:00.000Z',
          admissionBatchSize: 10,
          admissionIntervalSec: 30,
          status: 'OPEN',
          waitingCount: 3,
        }),
        join: vi.fn().mockRejectedValue(error),
        status: vi.fn(),
        leave: vi.fn(),
      };

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [EventQueue],
        providers: [
          provideRouter([]),
          { provide: QueueService, useValue: queue },
          { provide: ApiService, useValue: { get: () => of({ event: { title: 'Test Event' } }) } },
          { provide: AuthService, useValue: { isAuthenticated: () => true } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(EventQueue);
      fixture.componentRef.setInput('id', '7');
      fixture.detectChanges();
      await vi.waitFor(() => expect(queue.join).toHaveBeenCalledWith(7));
      await fixture.whenStable();
      fixture.detectChanges();
      return { queue, text: (fixture.nativeElement as HTMLElement).textContent ?? '', fixture };
    }
    const refusal = (code: string) =>
      new HttpErrorResponse({ status: 409, error: { error: code } });

    it('says the event has already taken place, and never polls for a queue place', async () => {
      const { queue, text, fixture } = await renderRefused(refusal('event_completed'));

      expect(text).toContain('The waiting room is unavailable');
      expect(text).toContain(
        'This event has already taken place, so tickets are no longer on sale.',
      );
      expect(queue.status).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('keeps the wording for an event that is not on sale, or has no waiting room', async () => {
      const notOnSale = await renderRefused(refusal('event_not_on_sale'));
      expect(notOnSale.text).toContain('Tickets for this event are not currently on sale.');
      notOnSale.fixture.destroy();

      const unconfigured = await renderRefused(refusal('queue_not_configured'));
      expect(unconfigured.text).toContain('The organiser has not configured a waiting room');
      unconfigured.fixture.destroy();
    });

    it('asks the customer to check their connection for an unrecognised failure', async () => {
      const { text, fixture } = await renderRefused(
        new HttpErrorResponse({ status: 502, error: { error: 'queue_join_failed' } }),
      );

      expect(text).toContain('Check your connection and try again.');
      expect(text).not.toContain('The waiting room is unavailable');
      fixture.destroy();
    });
  });
});
