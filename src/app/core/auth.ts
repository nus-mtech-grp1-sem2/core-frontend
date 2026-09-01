import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { COGNITO_CONFIG } from './auth-config';
import { ApiService } from './api';
import { AuthenticatedUser, CognitoGateway, NextStep } from './cognito-gateway';
import { UserRole, resolveRole } from './roles';

type Status = 'unknown' | 'authenticated' | 'anonymous';

interface RegistrationDraft {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

/**
 * Application-facing auth state.
 *
 * Holds the signed-in user as a signal so the header and route guards react to
 * it, and turns Cognito's exception names into messages a visitor can act on.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly gateway = inject(CognitoGateway);
  private readonly config = inject(COGNITO_CONFIG);
  private readonly api = inject(ApiService);

  private readonly _user = signal<AuthenticatedUser | null>(null);
  private readonly _status = signal<Status>('unknown');
  private readonly _demoRole = signal<UserRole | null>(null);
  private registrationDraft: RegistrationDraft | null = null;

  readonly user = this._user.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  /**
   * Local demo role override used when a developer selects a login type in the
   * browser for testing. This is never authoritative authorization; it only
   * drives the UI state in a local development session.
   */
  readonly role = computed<UserRole | null>(() => {
    const user = this._user();
    if (!user) {
      return null;
    }

    const demoRole = this._demoRole();
    if (demoRole) {
      return demoRole;
    }

    return resolveRole([], null, this.config.trustSelfDeclaredRole);
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

  async signIn(email: string, password: string): Promise<NextStep> {
    const result = await this.gateway.signIn(email, password);
    if (result.signedIn) {
      await this.restore();
      this.recordLogin();
    }
    return result.nextStep;
  }

  /**
   * Best-effort login audit call. Fire-and-forget and always swallows its own
   * errors: a network hiccup or backend outage must never stop a sign-in that
   * Cognito already approved.
   */
  private recordLogin(): void {
    this.gateway
      .idToken()
      .then((token) =>
        token
          ? firstValueFrom(
              this.api.post('auth', '/login-history', {}, {
                headers: { Authorization: `Bearer ${token}` },
              }),
            )
          : undefined,
      )
      .catch(() => {});
  }

  setDemoRole(role: UserRole): void {
    this._demoRole.set(role);
  }

  clearDemoRole(): void {
    this._demoRole.set(null);
  }

  async signUp(email: string, password: string, name: string, role: string): Promise<NextStep> {
    const result = await this.gateway.signUp(email, password, name, role);
    return result.nextStep;
  }

  rememberRegistration(email: string, name: string, password: string): void {
    this.registrationDraft = { email, name, password };
  }

  registrationDetails(email: string): { name: string; password: string } | null {
    if (!this.registrationDraft || this.registrationDraft.email !== email) {
      return null;
    }
    return { name: this.registrationDraft.name, password: this.registrationDraft.password };
  }

  clearRegistration(): void {
    this.registrationDraft = null;
  }

  async confirmSignUp(email: string, code: string): Promise<boolean> {
    return this.gateway.confirmSignUp(email, code);
  }

  /** Creates the `users` row (see backend-repo/database/TABLES.md §1); auth stays with Cognito. */
  async createUser(name: string, email?: string): Promise<void> {
    await firstValueFrom(this.api.post('auth', '/users', { name, ...(email ? { email } : {}) }));
  }

  async resendCode(email: string): Promise<void> {
    await this.gateway.resendCode(email);
  }

  async forgotPassword(email: string): Promise<void> {
    await this.gateway.forgotPassword(email);
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    await this.gateway.resetPassword(email, code, newPassword);
  }

  async signOut(): Promise<void> {
    await this.gateway.signOut();
    this.clearDemoRole();
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
