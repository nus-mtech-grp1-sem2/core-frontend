import { Injectable } from '@angular/core';
import {
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';

/** The identity of the signed-in user, as read from the access token claims. */
export interface AuthenticatedUser {
  readonly sub: string;
  readonly email: string;
  readonly groups: readonly string[];
  /** The role the user asked for at sign-up; not authoritative on its own. */
  readonly declaredRole: string | null;
}

/** What the caller has to do next after a sign-in or sign-up attempt. */
export type NextStep = 'done' | 'confirm-sign-up' | 'reset-password' | 'unsupported';

export interface SignInResult {
  readonly signedIn: boolean;
  readonly nextStep: NextStep;
}

/**
 * The only place the Amplify SDK is called.
 *
 * Everything else in the app depends on this narrow interface, so components
 * and tests never import the SDK and a swap of auth provider touches one file.
 */
@Injectable({ providedIn: 'root' })
export class CognitoGateway {
  async signIn(email: string, password: string): Promise<SignInResult> {
    const result = await signIn({ username: email, password });
    return { signedIn: result.isSignedIn, nextStep: mapStep(result.nextStep.signInStep) };
  }

  async signUp(
    email: string,
    password: string,
    name: string,
    role: string,
  ): Promise<SignInResult> {
    const result = await signUp({
      username: email,
      password,
      // `custom:role` is what the PostConfirmation Lambda reads to decide which
      // Cognito group to put the new user in.
      options: { userAttributes: { email, name, 'custom:role': role } },
    });
    return {
      signedIn: result.isSignUpComplete,
      nextStep: mapStep(result.nextStep.signUpStep),
    };
  }

  async confirmSignUp(email: string, code: string): Promise<boolean> {
    const result = await confirmSignUp({ username: email, confirmationCode: code });
    return result.isSignUpComplete;
  }

  async resendCode(email: string): Promise<void> {
    await resendSignUpCode({ username: email });
  }

  async signOut(): Promise<void> {
    await signOut();
  }

  /** The raw access token, refreshed by the SDK when it is close to expiry. */
  async accessToken(): Promise<string | null> {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken.toString() ?? null;
  }

  /**
   * Re-reads the user with freshly minted tokens.
   *
   * Group membership is baked into a token when it is issued, so after the
   * backend grants a group the current token still says nothing about it. This
   * exchanges the refresh token for new ones that carry the new claim.
   */
  async refresh(): Promise<AuthenticatedUser | null> {
    await fetchAuthSession({ forceRefresh: true });
    return this.currentUser();
  }

  /** Reads the current user from the token claims, or null when signed out. */
  async currentUser(): Promise<AuthenticatedUser | null> {
    const session = await fetchAuthSession();
    const claims = session.tokens?.idToken?.payload;
    if (!claims || typeof claims['sub'] !== 'string') {
      return null;
    }

    const groups = claims['cognito:groups'];
    const declared = claims['custom:role'];
    return {
      sub: claims['sub'],
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      groups: Array.isArray(groups) ? groups.map(String) : [],
      declaredRole: typeof declared === 'string' ? declared : null,
    };
  }
}

function mapStep(step: string): NextStep {
  switch (step) {
    case 'DONE':
      return 'done';
    case 'CONFIRM_SIGN_UP':
      return 'confirm-sign-up';
    case 'RESET_PASSWORD':
      return 'reset-password';
    default:
      return 'unsupported';
  }
}
