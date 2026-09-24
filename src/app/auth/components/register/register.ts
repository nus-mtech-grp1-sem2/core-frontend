import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { AuthService, describeAuthError } from '../../../core/auth';
import { AuthContinue } from '../auth-continue/auth-continue';
import { AuthShell } from '../auth-shell/auth-shell';

/** Starts Cognito Managed Login on the sign-up screen. */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthContinue, AuthShell],
  templateUrl: './register.html',
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
