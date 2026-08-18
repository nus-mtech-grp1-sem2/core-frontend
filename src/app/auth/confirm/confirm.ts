import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService, describeAuthError } from '../../core/auth';
import { AuthShell } from '../auth-shell/auth-shell';

/**
 * Second half of sign-up: Cognito emails a six digit code and the account
 * cannot sign in until it is entered. The email arrives as a query parameter
 * from the register form, and is also editable in case the visitor lands here
 * directly.
 */
@Component({
  selector: 'app-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell, ReactiveFormsModule, RouterLink],
  template: `
    <app-auth-shell
      heading="Confirm your email"
      lead="We sent a six digit code to your inbox. Enter it to activate your account."
      image="images/hero-concert.jpg"
      alt="Crowd lit by stage lights at a concert"
      quote="One more step to your tickets."
    >
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="form-notice" role="status">{{ notice() }}</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="email">Email address</label>
          <input id="email" type="email" autocomplete="email" formControlName="email" />
        </div>

        <div class="field">
          <label for="code">Confirmation code</label>
          <input
            id="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            formControlName="code"
            [attr.aria-invalid]="invalid('code')"
            [attr.aria-describedby]="invalid('code') ? 'code-error' : null"
          />
          @if (invalid('code')) {
            <p class="field-error" id="code-error">Enter the code from the email.</p>
          }
        </div>

        <button class="btn btn-primary submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Confirming…' : 'Confirm account' }}
        </button>
      </form>

      <p class="alt-action">
        Didn't get it?
        <button type="button" class="linklike" (click)="resend()" [disabled]="busy()">
          Send a new code
        </button>
        · <a routerLink="/login">Back to sign in</a>
      </p>
    </app-auth-shell>
  `,
  styles: `
    .submit {
      width: 100%;
    }

    .alt-action {
      margin-top: 1.5rem;
      font-size: 0.9375rem;
      color: var(--text-muted);
    }

    .alt-action a,
    .linklike {
      color: var(--brand-600);
      font-weight: 600;
      text-decoration: none;
    }

    .linklike {
      font: inherit;
      font-weight: 600;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
    }

    .alt-action a:hover,
    .linklike:hover {
      text-decoration: underline;
    }
  `,
})
export class Confirm {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly attempted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    code: ['', [Validators.required, Validators.minLength(6)]],
  });

  constructor() {
    const email = this.router.parseUrl(this.router.url).queryParams['email'];
    if (typeof email === 'string') {
      this.form.controls.email.setValue(email);
    }
  }

  protected invalid(control: 'email' | 'code'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || this.attempted());
  }

  protected async submit(): Promise<void> {
    this.attempted.set(true);
    this.error.set('');
    this.notice.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, code } = this.form.getRawValue();
    this.busy.set(true);

    try {
      await this.auth.confirmSignUp(email, code);
      await this.router.navigate(['/login'], { queryParams: { confirmed: 'true' } });
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async resend(): Promise<void> {
    this.error.set('');
    this.notice.set('');
    const email = this.form.controls.email.value;

    if (this.form.controls.email.invalid) {
      this.error.set('Enter your email address first.');
      return;
    }

    this.busy.set(true);
    try {
      await this.auth.resendCode(email);
      this.notice.set('A new code is on its way.');
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
