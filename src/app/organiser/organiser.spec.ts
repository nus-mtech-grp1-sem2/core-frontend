import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { EVENTS } from '../core/catalog';
import { Organiser } from './organiser';

const organiser: AuthenticatedUser = {
  sub: 's',
  email: 'organiser@example.com',
  groups: ['organiser'],
  declaredRole: null,
};

async function render(): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [Organiser],
    providers: [
      provideRouter([]),
      { provide: CognitoGateway, useValue: { currentUser: async () => organiser } },
    ],
  });

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(Organiser);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('Organiser', () => {
  it('shows the signed-in organiser', async () => {
    const host = await render();
    expect(host.textContent).toContain('organiser@example.com');
  });

  it('lists every event in the sample catalogue', async () => {
    const host = await render();
    expect(host.querySelectorAll('tbody tr').length).toBe(EVENTS.length);
  });

  it('summarises the events-listed, on-sale and lowest-price stats', async () => {
    const host = await render();
    const values = Array.from(host.querySelectorAll('.stat-value')).map((el) =>
      el.textContent?.trim(),
    );

    const onSale = EVENTS.filter((event) => event.status !== 'Sold out').length;
    const lowest = Math.min(...EVENTS.map((event) => event.priceFrom));

    expect(values[0]).toBe(String(EVENTS.length));
    expect(values[1]).toBe(String(onSale));
    expect(values[2]).toContain(String(lowest));
  });
});
