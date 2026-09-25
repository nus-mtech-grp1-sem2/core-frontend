import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { Organiser } from './organiser';

const DAY_MS = 24 * 60 * 60 * 1000;

function managedEvent(id: number, title: string, startsAt: Date, remainingQty: number) {
  return {
    event_id: id,
    title,
    description: null,
    venue: 'Esplanade',
    starts_at: startsAt.toISOString(),
    total_seats: 100,
    remaining_qty: remainingQty,
    price_cents: 5000,
    tier: 'TIER1_GA',
    status: 'PUBLISHED',
  };
}

describe('Organiser dashboard', () => {
  async function render() {
    await TestBed.configureTestingModule({
      imports: [Organiser],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { isAuthenticated: () => true, user: () => ({ email: 'org@example.com' }) },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Organiser);
    fixture.detectChanges();

    const now = Date.now();
    http.expectOne('/api/event/events/manage').flush({
      events: [
        managedEvent(1, 'Yesterday Gig', new Date(now - DAY_MS), 40),
        managedEvent(2, 'Next Week Gig', new Date(now + 7 * DAY_MS), 40),
        managedEvent(3, 'Next Month Sellout', new Date(now + 30 * DAY_MS), 0),
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    http.verify();
    return fixture.nativeElement as HTMLElement;
  }

  function rowFor(root: HTMLElement, title: string): HTMLTableRowElement {
    const row = Array.from(root.querySelectorAll('tbody tr')).find((tr) =>
      tr.querySelector('th')?.textContent?.includes(title),
    );
    if (!row) throw new Error(`no row for ${title}`);
    return row as HTMLTableRowElement;
  }

  it('does not count a completed event as on sale and shows it in its own card', async () => {
    const root = await render();
    const stats = Object.fromEntries(
      Array.from(root.querySelectorAll('.stats li')).map((li) => [
        li.querySelector('.stat-label')?.textContent?.trim(),
        li.querySelector('.stat-value')?.textContent?.trim(),
      ]),
    );

    expect(stats['Events listed']).toBe('3');
    expect(stats['On sale now']).toBe('1');
    expect(stats['Completed events']).toBe('1');
  });

  it('labels a past event Completed and disables its Update button', async () => {
    const root = await render();
    const row = rowFor(root, 'Yesterday Gig');

    expect(row.querySelector('.status')?.textContent?.trim()).toBe('Completed');
    expect(row.querySelector('a')).toBeNull();
    const update = row.querySelector('button');
    expect(update?.disabled).toBe(true);
  });

  it('keeps Update as a link for upcoming events', async () => {
    const root = await render();

    const onSale = rowFor(root, 'Next Week Gig');
    expect(onSale.querySelector('.status')?.textContent?.trim()).toBe('On sale');
    expect(onSale.querySelector('a')?.getAttribute('href')).toBe('/organiser/events/2');

    const soldOut = rowFor(root, 'Next Month Sellout');
    expect(soldOut.querySelector('.status')?.textContent?.trim()).toBe('Sold out');
    expect(soldOut.querySelector('a')?.getAttribute('href')).toBe('/organiser/events/3');
  });
});

describe('Organiser dashboard states and figures', () => {
  async function setup() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Organiser],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { isAuthenticated: () => true, user: () => ({ email: 'org@example.com' }) },
        },
      ],
    }).compileComponents();

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(Organiser);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const load = async (events: readonly object[]) => {
      http.expectOne('/api/event/events/manage').flush({ events });
      await settle();
    };
    return { http, host, settle, load };
  }

  /** An upcoming 100-seat event; override any API field. */
  const upcoming = (id: number, overrides: Record<string, unknown> = {}) => ({
    ...managedEvent(id, `Event ${id}`, new Date(Date.now() + 7 * DAY_MS), 100),
    ...overrides,
  });

  const stats = (host: HTMLElement) =>
    Object.fromEntries(
      Array.from(host.querySelectorAll('.stats li')).map((li) => [
        li.querySelector('.stat-label')?.textContent?.trim(),
        li.querySelector('.stat-value')?.textContent?.trim(),
      ]),
    );
  const pillFor = (host: HTMLElement, title: string) =>
    Array.from(host.querySelectorAll('tbody tr'))
      .find((row) => row.querySelector('th')?.textContent?.includes(title))
      ?.querySelector('.status');

  it('shows a loading message, then the events table', async () => {
    const { host, http, load } = await setup();

    expect(host.textContent).toContain('Loading your events…');
    expect(host.querySelector('table')).toBeNull();

    await load([upcoming(1)]);

    expect(host.textContent).not.toContain('Loading your events…');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('shows who is signed in', async () => {
    const { host, http, load } = await setup();
    await load([]);

    expect(host.querySelector('.lead')?.textContent).toContain('Signed in as org@example.com.');
    http.verify();
  });

  it('offers a retry when the events cannot be loaded, and recovers on retry', async () => {
    const { host, http, settle, load } = await setup();

    http
      .expectOne('/api/event/events/manage')
      .flush({ error: 'down' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    expect(host.textContent).toContain("Couldn't load your events.");
    expect(host.querySelector('table')).toBeNull();

    host.querySelector<HTMLButtonElement>('button.retry')?.click();
    await load([upcoming(1)]);

    expect(host.textContent).not.toContain("Couldn't load your events.");
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    http.verify();
  });

  it('shows zeroes and an empty table for an organiser with no events', async () => {
    const { host, http, load } = await setup();

    await load([]);

    expect(stats(host)).toMatchObject({
      'Events listed': '0',
      'On sale now': '0',
      'Completed events': '0',
      'Lowest ticket price': 'S$0',
    });
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
    http.verify();
  });

  it('marks stock below 15% as Few left, none as Sold out, and 15% or more as On sale', async () => {
    const { host, http, load } = await setup();

    await load([
      upcoming(1, { title: 'Almost gone', remaining_qty: 14 }),
      upcoming(2, { title: 'Threshold', remaining_qty: 15 }),
      upcoming(3, { title: 'None left', remaining_qty: 0 }),
    ]);

    expect(pillFor(host, 'Almost gone')?.textContent?.trim()).toBe('Few left');
    expect(pillFor(host, 'Almost gone')?.classList).toContain('few-left');
    expect(pillFor(host, 'Threshold')?.textContent?.trim()).toBe('On sale');
    expect(pillFor(host, 'Threshold')?.classList).toContain('on-sale');
    expect(pillFor(host, 'None left')?.textContent?.trim()).toBe('Sold out');
    expect(pillFor(host, 'None left')?.classList).toContain('sold-out');
    http.verify();
  });

  it('shows a cancelled event as Sold out however much stock it has', async () => {
    const { host, http, load } = await setup();

    await load([upcoming(1, { title: 'Called off', status: 'CANCELLED', remaining_qty: 80 })]);

    expect(pillFor(host, 'Called off')?.textContent?.trim()).toBe('Sold out');
    http.verify();
  });

  it('counts On sale and Few left as on sale now, but not Sold out or Completed', async () => {
    const { host, http, load } = await setup();

    await load([
      upcoming(1, { remaining_qty: 60 }),
      upcoming(2, { remaining_qty: 5 }),
      upcoming(3, { remaining_qty: 0 }),
      upcoming(4, { starts_at: new Date(Date.now() - DAY_MS).toISOString() }),
    ]);

    expect(stats(host)).toMatchObject({
      'Events listed': '4',
      'On sale now': '2',
      'Completed events': '1',
    });
    http.verify();
  });

  it('shows the cheapest ticket price across events in dollars', async () => {
    const { host, http, load } = await setup();

    await load([upcoming(1, { price_cents: 8000 }), upcoming(2, { price_cents: 2500 })]);

    expect(stats(host)['Lowest ticket price']).toBe('S$25');
    http.verify();
  });
});
