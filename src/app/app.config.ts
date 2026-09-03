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
import { AuthLifecycleService } from './core/auth-lifecycle';
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
  const lifecycle = inject(AuthLifecycleService);

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
        loginWith: {
          email: true,
          oauth: {
            domain: config.domain,
            scopes: ['openid', 'email', 'phone'],
            redirectSignIn: [...config.redirectSignIn],
            redirectSignOut: [...config.redirectSignOut],
            responseType: 'code',
          },
        },
      },
    },
  });

  // Tokens live in sessionStorage rather than localStorage: still readable by
  // script on this origin, but gone when the tab closes, which limits how long
  // a stolen token stays useful on a shared machine.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(amplifySessionStorage);

  return lifecycle.initialise();
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
        domain: 'ap-southeast-1cgmx4fpo2.auth.ap-southeast-1.amazoncognito.com',
        redirectSignIn: ['http://localhost:4200/', 'https://d84l1y8p4kdic.cloudfront.net'],
        redirectSignOut: ['http://localhost:4200/', 'https://d84l1y8p4kdic.cloudfront.net'],
      },
    },
  ],
};
