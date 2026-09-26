import { Injectable } from '@angular/core';
import { fetchAuthSession, signInWithRedirect, signOut } from 'aws-amplify/auth';

/** The identity of the signed-in user, as read from the access token claims. */
export interface AuthenticatedUser {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
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

  /**
   * Starts Cognito Managed Login on the sign-up screen.
   *
   * Amplify has no first-class "open on sign-up" option, so this reuses its
   * own authorize URL (state and PKCE included) and swaps the path from
   * `/oauth2/authorize` to Cognito's `/signup` alias, which renders the same
   * hosted UI with the sign-up form active. `authSessionOpener` is Amplify's
   * supported hook for controlling how the redirect is opened.
   */
  async signUp(): Promise<void> {
    await signInWithRedirect({
      options: {
        authSessionOpener: async (url) => {
          const signUpUrl = url.replace('/oauth2/authorize', '/signup');
          window.location.href = signUpUrl.replace('http://', 'https://');
        },
      },
    });
  }

  async signOut(): Promise<void> {
    await signOut();
  }

  /** The raw access token, refreshed by the SDK when it is close to expiry. */
  async accessToken(): Promise<string | null> {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken.toString() ?? null;
  }

  /** Reads the current user from the token claims, or null when signed out. */
  async currentUser(): Promise<AuthenticatedUser | null> {
    const session = await fetchAuthSession();
    const claims = session.tokens?.idToken?.payload;
    if (!claims || typeof claims['sub'] !== 'string') {
      return null;
    }

    const groups = claims['cognito:groups'];
    // The pool requires `name`; given/family names are optional, so they are only a fallback.
    const name = typeof claims['name'] === 'string' ? claims['name'].trim() : '';
    return {
      sub: claims['sub'],
      email: typeof claims['email'] === 'string' ? claims['email'] : '',
      name: name || [claims['given_name'], claims['family_name']].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '),
      groups: Array.isArray(groups) ? groups.map(String) : [],
    };
  }
}
