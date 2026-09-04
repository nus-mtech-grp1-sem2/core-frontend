import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { AuthService, describeAuthError } from '../../core/auth';
import { AuthShell } from '../auth-shell/auth-shell';

/** Starts Cognito Managed Login on the sign-up screen. */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell],
  template: `
    <app-auth-shell
      heading="Join OneStage"
      lead="Create your account securely with Cognito."
      image="images/hero-concert.jpg"
      alt="Crowd with hands raised at a live concert"
      quote="Your next favourite night out starts here."
    >
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }

      <p class="security-note">
        You will continue to the AWS Cognito sign-up page. OneStage never receives your password.
      </p>

      <button class="btn btn-primary submit" type="button" (click)="continue()" [disabled]="busy()">
        {{ busy() ? 'Redirecting…' : 'Continue to sign up' }}
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
export class Register {
  private readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async continue(): Promise<void> {
    this.busy.set(true);
    this.error.set('');

    try {
      await this.auth.signUp();
    } catch (error) {
      this.error.set(describeAuthError(error));
      this.busy.set(false);
    }
  }
}
