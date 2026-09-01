import { InjectionToken } from '@angular/core';

/**
 * Cognito user pool this build talks to.
 *
 * None of these are secrets — the SPA app client is a public client and must
 * have no client secret — so they are safe to ship in the bundle. Override the
 * token in `appConfig` per environment; the defaults point at nothing so a
 * misconfigured build fails loudly instead of talking to the wrong pool.
 */
export interface CognitoConfig {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
}

export const COGNITO_CONFIG = new InjectionToken<CognitoConfig>('COGNITO_CONFIG', {
  providedIn: 'root',
  factory: () => ({ userPoolId: '', userPoolClientId: '' }),
});

/** True once the pool has actually been configured for this build. */
export function isConfigured(config: CognitoConfig): boolean {
  return config.userPoolId.length > 0 && config.userPoolClientId.length > 0;
}
