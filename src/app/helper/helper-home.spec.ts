import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { HelperHome } from './helper-home';

const DAY_MS = 24 * 60 * 60 * 1000;

function shift(eventId: number, title: string, daysFromNow: number) {
  return {
    event_id: eventId,
    title,
    venue: 'Test Hall',
    starts_at: new Date(Date.now() + daysFromNow * DAY_MS).toISOString(),
    total_seats: 500,
  };
}

async function renderHome(events: readonly object[]): Promise<HTMLElement> {
  const get = vi.fn(() => of({ events }));

  await TestBed.configureTestingModule({
    imports: [HelperHome],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: { get } },
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
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(HelperHome);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function listAfter(root: HTMLElement, heading: string): HTMLElement | null {
  const title = Array.from(root.querySelectorAll('h2.section-title')).find(
    (el) => el.textContent?.trim() === heading,
  );
  return (title?.nextElementSibling as HTMLElement | null) ?? null;
}

function eventNames(list: HTMLElement | null): string[] {
  return Array.from(list?.querySelectorAll('.event') ?? []).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

describe('HelperHome shift lists', () => {
  it('lists only future events under Upcoming shifts and past events under Completed shifts', async () => {
    const root = await renderHome([
      shift(1, 'Older past show', -10),
      shift(2, 'Recent past show', -3),
      shift(3, 'Soon show', 3),
      shift(4, 'Later show', 10),
    ]);

    expect(eventNames(listAfter(root, 'Upcoming shifts'))).toEqual(['Soon show', 'Later show']);
    // Completed shifts read most-recent-first.
    expect(eventNames(listAfter(root, 'Completed shifts'))).toEqual([
      'Recent past show',
      'Older past show',
    ]);
  });

  it('places Completed shifts after Upcoming shifts', async () => {
    const root = await renderHome([shift(1, 'Past show', -3), shift(2, 'Future show', 3)]);

    const headings = Array.from(root.querySelectorAll('h2.section-title')).map((el) =>
      el.textContent?.trim(),
    );
    expect(headings).toEqual(['Upcoming shifts', 'Completed shifts']);
  });

  it('omits the Completed shifts section when the helper has no past events', async () => {
    const root = await renderHome([shift(1, 'Future show', 3)]);

    expect(listAfter(root, 'Completed shifts')).toBeNull();
    expect(eventNames(listAfter(root, 'Upcoming shifts'))).toEqual(['Future show']);
  });

  it('shows the empty message under Upcoming shifts when every event is in the past', async () => {
    const root = await renderHome([shift(1, 'Past show', -3)]);

    expect(listAfter(root, 'Upcoming shifts')?.textContent).toContain('Nothing scheduled');
    expect(eventNames(listAfter(root, 'Completed shifts'))).toEqual(['Past show']);
  });

  it("keeps today's shift in the On tonight card, outside both lists", async () => {
    const root = await renderHome([shift(1, 'Tonight show', 0), shift(2, 'Past show', -3)]);

    expect(root.querySelector('.on-now')?.textContent).toContain('Tonight show');
    expect(eventNames(listAfter(root, 'Upcoming shifts'))).toEqual([]);
    expect(eventNames(listAfter(root, 'Completed shifts'))).toEqual(['Past show']);
  });
});
