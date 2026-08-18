import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';

import { AuthService } from './auth';
import { roleGuard } from './auth-guard';
import { AuthenticatedUser, CognitoGateway } from './cognito-gateway';
import { resolveRole, roleFromGroups } from './roles';

describe('roleFromGroups', () => {
  it('treats a user with no groups as a customer', () => {
    expect(roleFromGroups([])).toBe('customer');
  });

  it('reads each role from its Cognito group', () => {
    expect(roleFromGroups(['organiser'])).toBe('organiser');
    expect(roleFromGroups(['event-helper'])).toBe('event-helper');
    expect(roleFromGroups(['customer'])).toBe('customer');
  });

  it('gives the most privileged role when a user is in several groups', () => {
    expect(roleFromGroups(['customer', 'event-helper', 'organiser'])).toBe('organiser');
    expect(roleFromGroups(['customer', 'event-helper'])).toBe('event-helper');
  });

  it('ignores casing and stray whitespace from the pool', () => {
    expect(roleFromGroups([' Organiser '])).toBe('organiser');
  });

  it('ignores groups it does not know', () => {
    expect(roleFromGroups(['admin', 'finance'])).toBe('customer');
  });
});

describe('resolveRole', () => {
  it('prefers real group membership over the declared attribute', () => {
    expect(resolveRole(['customer'], 'organiser', true)).toBe('customer');
    expect(resolveRole(['organiser'], 'customer', true)).toBe('organiser');
  });

  it('falls back to the declared role only when the user has no groups', () => {
    expect(resolveRole([], 'organiser', true)).toBe('organiser');
    expect(resolveRole([], 'event-helper', true)).toBe('event-helper');
  });

  it('ignores the declared role when the build does not trust it', () => {
    expect(resolveRole([], 'organiser', false)).toBe('customer');
  });

  it('ignores a declared role that is not a real role', () => {
    expect(resolveRole([], 'admin', true)).toBe('customer');
    expect(resolveRole([], null, true)).toBe('customer');
  });
});

describe('roleGuard', () => {
  const routes: Routes = [
    { path: '', children: [] },
    { path: 'login', children: [] },
    { path: 'organiser', children: [] },
  ];

  function configure(user: AuthenticatedUser | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        {
          provide: CognitoGateway,
          useValue: { currentUser: async () => user },
        },
      ],
    });
  }

  async function run(user: AuthenticatedUser | null) {
    configure(user);
    const guard = roleGuard('organiser');
    return TestBed.runInInjectionContext(() =>
      guard({} as never, { url: '/organiser' } as never),
    );
  }

  it('sends a signed-out visitor to sign in, remembering the destination', async () => {
    const result = await run(null);
    expect(String(result)).toContain('/login');
    expect(String(result)).toContain('returnUrl');
  });

  it('sends a customer home rather than to a login form', async () => {
    const result = await run({ sub: 's', email: 'c@example.com', groups: ['customer'], declaredRole: null });
    expect(String(result)).toBe('/');
  });

  it('admits an organiser', async () => {
    const result = await run({ sub: 's', email: 'o@example.com', groups: ['organiser'], declaredRole: null });
    expect(result).toBe(true);
  });

  it('keeps the role on the auth service in step', async () => {
    configure({ sub: 's', email: 'h@example.com', groups: ['event-helper'], declaredRole: null });
    const auth = TestBed.inject(AuthService);
    await auth.restore();

    expect(auth.role()).toBe('event-helper');
    expect(auth.hasRole('event-helper', 'organiser')).toBe(true);
    expect(auth.hasRole('organiser')).toBe(false);
  });
});

describe('Router integration', () => {
  it('blocks /organiser for a customer', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', children: [] },
          {
            path: 'organiser',
            canActivate: [roleGuard('organiser')],
            children: [],
          },
        ]),
        {
          provide: CognitoGateway,
          useValue: {
            currentUser: async () => ({ sub: 's', email: 'c@example.com', groups: [], declaredRole: null }),
          },
        },
      ],
    });

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/organiser');

    expect(router.url).toBe('/');
  });
});
