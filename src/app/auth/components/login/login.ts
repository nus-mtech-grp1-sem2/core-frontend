import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { AuthService, describeAuthError } from '../../../core/auth';
import { AuthContinue } from '../auth-continue/auth-continue';
import { AuthShell } from '../auth-shell/auth-shell';

/** Starts Cognito Managed Login using Authorization Code + PKCE. */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthContinue, AuthShell],
  templateUrl: './login.html',
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
