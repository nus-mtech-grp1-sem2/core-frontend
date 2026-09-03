import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthenticatedUser, CognitoGateway } from './cognito-gateway';
import { UserRole, roleFromGroups } from './roles';

type Status = 'unknown' | 'authenticated' | 'anonymous';

/**
 * Application-facing auth state.
 *
 * Holds the signed-in user as a signal so the header and route guards react to
 * it, and turns Cognito's exception names into messages a visitor can act on.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly gateway = inject(CognitoGateway);
  private readonly _user = signal<AuthenticatedUser | null>(null);
  private readonly _status = signal<Status>('unknown');

  readonly user = this._user.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  /** Role for the signed-in user, derived from their Cognito groups. */
  readonly role = computed<UserRole | null>(() => {
    const user = this._user();
    if (!user) {
      return null;
    }
    return roleFromGroups(user.groups);
  });

  /** Restores the session on startup; safe to call more than once. */
  async restore(): Promise<void> {
    try {
      const user = await this.gateway.currentUser();
      this.apply(user);
    } catch {
      this.apply(null);
    }
  }

  /** Re-reads the session with new tokens, picking up any group just granted. */
  async refresh(): Promise<void> {
    try {
      this.apply(await this.gateway.refresh());
    } catch {
      // Keep whatever we had; the next restore() will correct it.
    }
  }

  async signIn(): Promise<void> {
    await this.gateway.signIn();
  }

  async signOut(): Promise<void> {
    await this.gateway.signOut();
    this.apply(null);
  }

  accessToken(): Promise<string | null> {
    return this.gateway.accessToken();
  }

  hasGroup(group: string): boolean {
    return this._user()?.groups.includes(group) ?? false;
  }

  hasRole(...roles: readonly UserRole[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  private apply(user: AuthenticatedUser | null): void {
    this._user.set(user);
    this._status.set(user ? 'authenticated' : 'anonymous');
  }
}

/**
 * Cognito reports failures by exception name. Map the ones a visitor can do
 * something about; anything else gets a generic message so we never surface
 * raw SDK text in the UI.
 */
export function describeAuthError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? '';

  switch (name) {
    case 'NotAuthorizedException':
      return 'That email and password combination is not correct.';
    case 'UserNotFoundException':
      return 'No account exists for that email address.';
    case 'UserNotConfirmedException':
      return 'Your account is not confirmed yet. Enter the code we emailed you.';
    case 'UsernameExistsException':
      return 'An account with that email address already exists.';
    case 'InvalidPasswordException':
      return 'That password does not meet the password policy.';
    case 'CodeMismatchException':
      return 'That confirmation code is not correct.';
    case 'ExpiredCodeException':
      return 'That confirmation code has expired. Request a new one.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'AuthUserPoolException':
      return 'Authentication is not configured for this build yet.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
