import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { AuthService, describeAuthError } from '../../core/auth';
import { AuthShell } from '../auth-shell/auth-shell';

/** Starts Cognito Managed Login using Authorization Code + PKCE. */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell],
  template: `
    <app-auth-shell
      heading="Welcome to OneStage"
      lead="Sign in or create an account securely with Cognito."
      image="images/hero-theatre.jpg"
      alt="Silhouetted performers against a red stage curtain"
      quote="Your seats are waiting."
    >
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }

      <p class="security-note">
        You will continue to the AWS Cognito sign-in page. OneStage never receives your password.
      </p>

      <button class="btn btn-primary submit" type="button" (click)="continue()" [disabled]="busy()">
        {{ busy() ? 'Redirecting…' : 'Continue to sign in' }}
      </button>
    </app-auth-shell>
  `,
  styles: `
    .security-note {
      margin: 0 0 1.25rem;
      color: var(--text-muted);
      line-height: 1.6;
    }

    .submit {
      width: 100%;
    }
  `,
})
export class Login {
  private readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async continue(): Promise<void> {
    this.busy.set(true);
    this.error.set('');

    try {
      await this.auth.signIn();
    } catch (error) {
      this.error.set(describeAuthError(error));
      this.busy.set(false);
    }
  }
}
