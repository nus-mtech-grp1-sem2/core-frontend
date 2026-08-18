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

  /**
   * Whether to fall back to the `custom:role` attribute a user picked at sign
   * up when they are in no Cognito group.
   *
   * That attribute is self-asserted, so this is a development convenience: it
   * lets the three roles be demonstrated before the PostConfirmation Lambda
   * that grants real group membership is deployed. Turn it off once the Lambda
   * is live — group membership always wins either way.
   */
  readonly trustSelfDeclaredRole: boolean;
}

export const COGNITO_CONFIG = new InjectionToken<CognitoConfig>('COGNITO_CONFIG', {
  providedIn: 'root',
  factory: () => ({ userPoolId: '', userPoolClientId: '', trustSelfDeclaredRole: false }),
});

/** True once the pool has actually been configured for this build. */
export function isConfigured(config: CognitoConfig): boolean {
  return config.userPoolId.length > 0 && config.userPoolClientId.length > 0;
}
