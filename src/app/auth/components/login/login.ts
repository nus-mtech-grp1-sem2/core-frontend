import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { AuthService, describeAuthError } from '../../../core/auth';
import { AuthCallbackFeedbackService } from '../../../core/auth-callback-feedback';
import { AuthReturnUrlService } from '../../../core/auth-return-url';
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
  private readonly callbackFeedback = inject(AuthCallbackFeedbackService);
  private readonly route = inject(ActivatedRoute);
  private readonly returnUrl = inject(AuthReturnUrlService);

  protected readonly busy = signal(false);
  protected readonly error = signal(this.callbackFeedback.take());

  protected async continue(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.returnUrl.remember(this.route.snapshot.queryParamMap.get('returnUrl'));

    try {
      await this.auth.signIn();
    } catch (error) {
      this.error.set(describeAuthError(error));
      this.busy.set(false);
    }
  }
}
