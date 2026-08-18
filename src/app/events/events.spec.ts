import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Events } from './events';

describe('Events', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Events],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('lists every event with artwork and a price', async () => {
    const fixture = TestBed.createComponent(Events);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.event-card').length).toBe(8);
    expect(host.querySelectorAll('.event-card img').length).toBe(8);
    expect(host.querySelector('.from-price')?.textContent).toContain('S$');
  });

  it('filters the grid by category', async () => {
    const fixture = TestBed.createComponent(Events);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const theatre = Array.from(host.querySelectorAll<HTMLButtonElement>('.chip')).find(
      (chip) => chip.textContent?.trim() === 'Theatre',
    );
    theatre?.click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.event-card').length).toBe(2);
    expect(host.querySelector('.count')?.textContent).toContain('2 events');
  });
});
