import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Tickets } from './tickets';

function rowPrices(host: HTMLElement): number[] {
  return Array.from(host.querySelectorAll('tbody .price')).map((cell) =>
    Number(cell.textContent?.replace(/[^\d]/g, '')),
  );
}

describe('Tickets', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tickets],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('sorts listings by price', async () => {
    const fixture = TestBed.createComponent(Tickets);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = 'price-asc';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    const prices = rowPrices(host);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('hides sold out listings on request', async () => {
    const fixture = TestBed.createComponent(Tickets);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const before = host.querySelectorAll('tbody tr').length;

    const toggle = host.querySelector('.switch input') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(host.querySelectorAll('tbody tr').length).toBe(before - 1);
    expect(host.textContent).not.toContain('Sold out');
  });
});
