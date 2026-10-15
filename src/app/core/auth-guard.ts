import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth';

/**
 * Blocks a route until the visitor is signed in, remembering where they were
 * headed so sign-in can send them back there.
 *
 * Every signed-in account has access
 * to the storefront, the organiser workspace and the event-helper workspace
 * alike. Ticket selection additionally requires a live queue admission.
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
