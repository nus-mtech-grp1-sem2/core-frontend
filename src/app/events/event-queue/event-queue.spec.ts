import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { QueueService, QueueStatus } from '../../core/queue';
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
});
