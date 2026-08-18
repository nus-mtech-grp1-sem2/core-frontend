import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';

import { AuthService } from './auth';

/**
 * Attaches the Cognito access token to API calls.
 *
 * The access token is what the backend authorises against; the id token
 * describes the user to this app and must not be sent instead. Requests that
 * already carry an Authorization header are left alone.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.headers.has('Authorization')) {
    return next(req);
  }

  const auth = inject(AuthService);

  return from(auth.accessToken()).pipe(
    switchMap((token) =>
      next(
        token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req,
      ),
    ),
  );
};
