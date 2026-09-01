import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../../core/cognito-gateway';
import { UserRole } from '../../core/roles';
import { Header } from './header';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', groups, declaredRole: null };
}

async function navFor(current: AuthenticatedUser | null, demoRole?: UserRole) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Header],
    providers: [
      provideRouter([]),
      {
        provide: CognitoGateway,
        useValue: { currentUser: async () => current, signOut: async () => undefined },
      },
    ],
  });

  const auth = TestBed.inject(AuthService);
  await auth.restore();
  if (demoRole) {
    auth.setDemoRole(demoRole);
  }
  const fixture = TestBed.createComponent(Header);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;

  return {
    host,
    labels: Array.from(host.querySelectorAll('.primary a')).map((a) => a.textContent?.trim()),
    hasSearch: host.querySelector('.search') !== null,
  };
}

describe('Header navigation', () => {
  it('offers the storefront to a signed-out visitor', async () => {
    const { labels, hasSearch, host } = await navFor(null);

    expect(labels).toEqual(['Events', 'Tickets']);
    expect(hasSearch).toBe(true);
    expect(host.textContent).toContain('Login');
    expect(host.textContent).toContain('Register');
  });

  it('offers only Tickets to a customer, with their account actions', async () => {
    const { labels, hasSearch, host } = await navFor(user(['customer']));

    expect(labels).toEqual(['Tickets']);
    expect(hasSearch).toBe(true);
    expect(host.textContent).toContain('Sign out');
    expect(host.textContent).not.toContain('Login');
  });

  it('gives an organiser (admin) only Events, and no search box', async () => {
    const { labels, hasSearch } = await navFor(user(['organiser']), 'organiser');

    expect(labels).toEqual(['Events']);
    expect(labels).not.toContain('Tickets');
    expect(hasSearch).toBe(false);
  });

  it('gives an event helper only Events', async () => {
    const { labels, hasSearch } = await navFor(user(['event-helper']), 'event-helper');

    expect(labels).toEqual(['Events']);
    expect(labels).not.toContain('Tickets');
    expect(hasSearch).toBe(false);
  });

  it('shows the role badge next to the signed-in email', async () => {
    const { host } = await navFor(user(['event-helper']), 'event-helper');

    expect(host.querySelector('.role')?.textContent?.trim()).toBe('Event Helper');
  });
});
