import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../../core/cognito-gateway';
import { Header } from './header';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', groups };
}

async function navFor(current: AuthenticatedUser | null) {
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

  await TestBed.inject(AuthService).restore();
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

  it('offers the same storefront to a customer, with their account actions', async () => {
    const { labels, hasSearch, host } = await navFor(user(['customer']));

    expect(labels).toEqual(['Events', 'Tickets']);
    expect(hasSearch).toBe(true);
    expect(host.textContent).toContain('Sign out');
    expect(host.textContent).not.toContain('Login');
  });

  it('gives an organiser only their dashboard, and no search box', async () => {
    const { labels, hasSearch } = await navFor(user(['organiser']));

    expect(labels).toEqual(['Dashboard']);
    expect(labels).not.toContain('Tickets');
    expect(labels).not.toContain('Events');
    expect(hasSearch).toBe(false);
  });

  it('gives an event helper only their two screens', async () => {
    const { labels, hasSearch } = await navFor(user(['event-helper']));

    expect(labels).toEqual(['My shifts', 'Check-in']);
    expect(labels).not.toContain('Dashboard');
    expect(hasSearch).toBe(false);
  });

  it('shows the role badge next to the signed-in email', async () => {
    const { host } = await navFor(user(['event-helper']));

    expect(host.querySelector('.role')?.textContent?.trim()).toBe('Event helper');
  });
});
