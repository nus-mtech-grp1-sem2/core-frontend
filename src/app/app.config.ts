import { DOCUMENT } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  NavigationError,
  provideRouter,
  withComponentInputBinding,
  withNavigationErrorHandler,
} from '@angular/router';
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { sessionStorage as amplifySessionStorage } from 'aws-amplify/utils';

import { routes } from './app.routes';
import { AuthService } from './core/auth';
import { COGNITO_CONFIG, isConfigured } from './core/auth-config';
import { authInterceptor } from './core/auth-interceptor';

/** Marks that this tab already reloaded itself, so a broken build cannot loop. */
const RELOAD_KEY = 'onestage:reloaded-for-stale-bundle';

/**
 * Lazy routes fetch their chunk on first navigation. When a tab is left open
 * across a rebuild the old chunk URLs are gone, the import rejects, and the
 * router silently cancels the navigation — the page just does not move. Reload
 * once to pick up the new bundle, and make anything else loud in the console.
 */
function handleNavigationError(event: NavigationError): void {
  const view = inject(DOCUMENT).defaultView;
  const message = String((event.error as Error | undefined)?.message ?? event.error);
  const staleBundle = /dynamically imported module|module script failed|loading chunk/i.test(
    message,
  );

  if (staleBundle && view && !view.sessionStorage.getItem(RELOAD_KEY)) {
    view.sessionStorage.setItem(RELOAD_KEY, '1');
    view.location.reload();
    return;
  }

  console.error(`Navigation to ${event.url} failed:`, event.error);
}

/**
 * Points the Amplify SDK at this build's user pool and restores any existing
 * session before the first render, so the header does not flash "Login" at a
 * visitor who is already signed in.
 */
function initialiseAuth(): Promise<void> | void {
  const config = inject(COGNITO_CONFIG);
  const auth = inject(AuthService);

  if (!isConfigured(config)) {
    console.warn(
      'Cognito is not configured: set COGNITO_CONFIG in app.config.ts. Sign-in will fail until then.',
    );
    return;
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
      },
    },
  });

  // Tokens live in sessionStorage rather than localStorage: still readable by
  // script on this origin, but gone when the tab closes, which limits how long
  // a stolen token stays useful on a shared machine.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(amplifySessionStorage);

  return auth.restore();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withNavigationErrorHandler(handleNavigationError),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideAppInitializer(initialiseAuth),

    // Per-environment pool. Neither value is a secret, but they must match the
    // environment being deployed. Amplify infers the region from the pool id.
    {
      provide: COGNITO_CONFIG,
      useValue: {
        userPoolId: 'ap-southeast-1_cgmx4fpO2',
        userPoolClientId: 'gh94lqsterju3qoffje1grep8',

        // TODO: set to false once the PostConfirmation Lambda is deployed, so
        // roles come only from real Cognito group membership.
        trustSelfDeclaredRole: true,
      },
    },
  ],
};
