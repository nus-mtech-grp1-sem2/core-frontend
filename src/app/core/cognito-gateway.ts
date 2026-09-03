import { Injectable } from '@angular/core';
import { fetchAuthSession, signInWithRedirect, signOut } from 'aws-amplify/auth';

/** The identity of the signed-in user, as read from the access token claims. */
export interface AuthenticatedUser {
  readonly sub: string;
  readonly email: string;
  readonly groups: readonly string[];
}

/**
 * The only place the Amplify SDK is called.
 *
 * Everything else in the app depends on this narrow interface, so components
 * and tests never import the SDK and a swap of auth provider touches one file.
 */
@Injectable({ providedIn: 'root' })
export class CognitoGateway {
  async signIn(): Promise<void> {
    await signInWithRedirect();
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
    return {
      sub: claims['sub'],
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      groups: Array.isArray(groups) ? groups.map(String) : [],
    };
  }
}
