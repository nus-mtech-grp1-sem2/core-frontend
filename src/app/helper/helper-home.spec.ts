import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { MY_SHIFTS } from '../core/catalog';
import { HelperHome } from './helper-home';

const helper: AuthenticatedUser = {
  sub: 's',
  email: 'jamie@example.com',
  groups: ['event-helper'],
  declaredRole: null,
};

async function render(): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [HelperHome],
    providers: [
      provideRouter([]),
      { provide: CognitoGateway, useValue: { currentUser: async () => helper } },
    ],
  });

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(HelperHome);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('HelperHome', () => {
  it('greets the signed-in helper by the local part of their email', async () => {
    const host = await render();
    expect(host.querySelector('h1')?.textContent).toContain('jamie');
  });

  it("shows tonight's shift with a link to check-in", async () => {
    const host = await render();
    const onNow = host.querySelector('.on-now');

    expect(onNow).not.toBeNull();
    expect(onNow?.textContent).toContain(MY_SHIFTS.find((shift) => shift.today)?.event);
    expect(host.querySelector('.on-now a')?.getAttribute('href')).toBe('/checkin');
  });

  it('lists the shifts that are not today', async () => {
    const host = await render();
    const expectedUpcoming = MY_SHIFTS.filter((shift) => !shift.today).length;

    expect(host.querySelectorAll('.shifts li:not(.empty)').length).toBe(expectedUpcoming);
  });
});
