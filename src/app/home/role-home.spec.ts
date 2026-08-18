import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { RoleHome } from './role-home';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', groups, declaredRole: null };
}

async function renderFor(current: AuthenticatedUser | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RoleHome],
    providers: [
      provideRouter([]),
      { provide: CognitoGateway, useValue: { currentUser: async () => current } },
    ],
  });

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(RoleHome);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('RoleHome', () => {
  it('shows the storefront to a signed-out visitor', async () => {
    const host = await renderFor(null);

    expect(host.querySelector('app-home')).not.toBeNull();
    expect(host.querySelector('app-organiser')).toBeNull();
    expect(host.querySelector('app-helper-home')).toBeNull();
    // Nothing personalised, but the pitch to sign up is there.
    expect(host.querySelector('.orders')).toBeNull();
    expect(host.querySelector('.cta')).not.toBeNull();
  });

  it('shows the storefront plus the account area to a customer', async () => {
    const host = await renderFor(user(['customer']));

    expect(host.querySelector('app-home')).not.toBeNull();
    expect(host.querySelectorAll('.orders li').length).toBe(2);
    // The account section sits under the hero, not above it.
    const sections = Array.from(host.querySelectorAll('app-carousel, .orders'));
    expect(sections[0]?.tagName.toLowerCase()).toBe('app-carousel');
    // No "create an account" pitch at someone who already has one.
    expect(host.querySelector('.cta')).toBeNull();
    expect(host.querySelector('.assurances')).toBeNull();
  });

  it('shows the organiser workspace to an organiser', async () => {
    const host = await renderFor(user(['organiser']));

    expect(host.querySelector('app-organiser')).not.toBeNull();
    expect(host.querySelector('app-home')).toBeNull();
  });

  it('shows the shift board to an event helper', async () => {
    const host = await renderFor(user(['event-helper']));

    expect(host.querySelector('app-helper-home')).not.toBeNull();
    expect(host.querySelector('app-home')).toBeNull();
    expect(host.textContent).toContain('On tonight');
  });

  it('gives an organiser who also helps the organiser view', async () => {
    const host = await renderFor(user(['event-helper', 'organiser']));

    expect(host.querySelector('app-organiser')).not.toBeNull();
    expect(host.querySelector('app-helper-home')).toBeNull();
  });
});
