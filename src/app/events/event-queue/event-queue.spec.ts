import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../../core/api';
import { AuthService } from '../../core/auth';
import { QueueService } from '../../core/queue';
import { EventQueue } from './event-queue';

describe('EventQueue', () => {
  it('joins after the router supplies the event id input', async () => {
    const queue = {
      summary: vi.fn().mockResolvedValue({
        eventId: 7,
        opensAt: '2026-09-16T12:00:00.000Z',
        admissionBatchSize: 10,
        admissionIntervalSec: 30,
        status: 'OPEN',
        waitingCount: 3,
      }),
      join: vi.fn().mockResolvedValue({ queueEntryId: 71, status: 'WAITING', position: 4 }),
      status: vi.fn(),
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
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(queue.summary).toHaveBeenCalledWith(7);
    expect(queue.join).toHaveBeenCalledWith(7);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Position');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('4');
    fixture.destroy();
  });
});
