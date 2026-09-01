import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';

import { AuthService } from './auth';
import { roleGuard } from './auth-guard';
import { AuthenticatedUser, CognitoGateway } from './cognito-gateway';
import { resolveRole, roleFromGroups } from './roles';

describe('roleFromGroups', () => {
  it('never treats Cognito groups as the application authorization source', () => {
    expect(roleFromGroups([])).toBe('customer');
    expect(roleFromGroups(['organiser'])).toBe('customer');
    expect(roleFromGroups(['event-helper'])).toBe('customer');
    expect(roleFromGroups(['customer'])).toBe('customer');
  });
});

describe('resolveRole', () => {
  it('defaults to a customer role until the backend customer record is loaded', () => {
    expect(resolveRole([], null, true)).toBe('customer');
    expect(resolveRole(['organiser'], 'customer', true)).toBe('customer');
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
