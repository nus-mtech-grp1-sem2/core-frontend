import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth';
import { UserRole } from './roles';

/**
 * Blocks a route until the visitor is signed in, remembering where they were
 * headed so sign-in can send them back there.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.status() === 'unknown') {
    await auth.restore();
  }

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * Restricts a route to particular roles. Signed-out visitors are sent to sign
 * in; signed-in visitors without the role are sent home rather than to a login
 * form they have already satisfied.
 *
 * This is a usability measure, not a security boundary — the services must
 * check the group claim themselves, since anyone can call the API directly.
 */
export function roleGuard(...allowed: readonly UserRole[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (auth.status() === 'unknown') {
      await auth.restore();
    }

    if (!auth.isAuthenticated()) {
      return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    }

    return auth.hasRole(...allowed) ? true : router.createUrlTree(['/']);
  };
}
