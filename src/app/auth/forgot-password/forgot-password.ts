import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService, describeAuthError } from '../../core/auth';
import { AuthShell } from '../auth-shell/auth-shell';

@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell, ReactiveFormsModule, RouterLink],
  template: `
    <app-auth-shell
      heading="Reset your password"
      lead="We’ll send a code to your email so you can set a new password and sign back in securely."
      image="images/hero-theatre.jpg"
      alt="Silhouetted performers against a red stage curtain"
      quote="Keep your account secure."
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
          <input
            id="email"
            type="email"
            autocomplete="email"
            formControlName="email"
            [attr.aria-invalid]="invalid('email')"
            [attr.aria-describedby]="invalid('email') ? 'email-error' : null"
          />
          @if (invalid('email')) {
            <p class="field-error" id="email-error">Enter a valid email address.</p>
          }
        </div>

        <div class="field">
          <label for="newPassword">New password</label>
          <div class="password-control">
            <input
              id="newPassword"
              [type]="showPassword() ? 'text' : 'password'"
              autocomplete="new-password"
              formControlName="newPassword"
              [attr.aria-invalid]="invalid('newPassword')"
              [attr.aria-describedby]="invalid('newPassword') ? 'new-password-error' : null"
            />
            <button
              class="password-toggle"
              type="button"
              [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
              [attr.aria-pressed]="showPassword()"
              [title]="showPassword() ? 'Hide password' : 'Show password'"
              (click)="showPassword.set(!showPassword())"
            >
              <span class="eye-icon" aria-hidden="true"></span>
            </button>
          </div>
          @if (invalid('newPassword')) {
            <p class="field-error" id="new-password-error">
              Your password must be at least 8 characters.
            </p>
          }
        </div>

        <div class="field">
          <label for="confirmPassword">Confirm new password</label>
          <div class="password-control">
            <input
              id="confirmPassword"
              [type]="showConfirmPassword() ? 'text' : 'password'"
              autocomplete="new-password"
              formControlName="confirmPassword"
              [attr.aria-invalid]="mismatch()"
              [attr.aria-describedby]="mismatch() ? 'confirm-password-error' : null"
            />
            <button
              class="password-toggle"
              type="button"
              [attr.aria-label]="showConfirmPassword() ? 'Hide password' : 'Show password'"
              [attr.aria-pressed]="showConfirmPassword()"
              [title]="showConfirmPassword() ? 'Hide password' : 'Show password'"
              (click)="showConfirmPassword.set(!showConfirmPassword())"
            >
              <span class="eye-icon" aria-hidden="true"></span>
            </button>
          </div>
          @if (mismatch()) {
            <p class="field-error" id="confirm-password-error">Both passwords must match.</p>
          }
        </div>

        <div class="field">
          <label for="code">Verification code</label>
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
            <p class="field-error" id="code-error">Enter the code that was emailed to you.</p>
          }
        </div>

        <div class="actions">
          <button 
            class="btn btn-secondary"
            type="button"
            data-testid="request-reset-code"
            [disabled]="busy() || form.controls.email.invalid"
            (click)="requestResetCode()"
          >
            {{ busy() ? 'Sending…' : 'Send code' }}
          </button>

          <button
            class="btn btn-primary"
            type="submit"
            data-testid="confirm-reset-password"
            [disabled]="busy()"
          >
            {{ busy() ? 'Resetting…' : 'Reset password' }}
          </button>
        </div>
      </form>

      <p class="alt-action">
        Remembered it? <a routerLink="/login">Back to sign in</a>
      </p>
    </app-auth-shell>
  `,
  styles: `
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .btn {
      flex: 1 1 12rem;
    }

    .password-control {
      position: relative;
      width: 100%;
    }

    .password-control input {
      box-sizing: border-box;
      width: 100%;
      padding-right: 3.25rem;
    }

    .password-toggle {
      position: absolute;
      top: 50%;
      right: 0.75rem;
      display: grid;
      width: 2rem;
      height: 2rem;
      padding: 0;
      place-items: center;
      border: 0;
      border-radius: 0.35rem;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transform: translateY(-50%);
    }

    .password-toggle:hover,
    .password-toggle:focus-visible {
      color: var(--brand-600);
      background: var(--surface-muted);
    }

    .eye-icon {
      display: block;
      width: 1.15rem;
      height: 0.72rem;
      border: 1.8px solid currentColor;
      border-radius: 75% 15%;
      transform: rotate(45deg);
    }

    .eye-icon::after {
      display: block;
      width: 0.32rem;
      height: 0.32rem;
      margin: 0.08rem auto;
      border-radius: 50%;
      background: currentColor;
      content: '';
    }

    .alt-action {
      margin-top: 1.5rem;
      font-size: 0.9375rem;
      color: var(--text-muted);
    }

    .alt-action a {
      color: var(--brand-600);
      font-weight: 600;
      text-decoration: none;
    }

    .alt-action a:hover {
      text-decoration: underline;
    }
  `,
})
export class ForgotPassword {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    code: ['', [Validators.required, Validators.minLength(6)]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor() {
    const email = this.router.parseUrl(this.router.url).queryParams['email'];
    if (typeof email === 'string') {
      this.form.controls.email.setValue(email);
    }
  }

  protected invalid(control: 'email' | 'code' | 'newPassword'): boolean {
    const field = this.form.controls[control];
    return field.invalid && field.touched;
  }

  protected mismatch(): boolean {
    return (
      this.form.controls.confirmPassword.touched &&
      this.form.controls.newPassword.value !== this.form.controls.confirmPassword.value &&
      this.form.controls.newPassword.value.length > 0
    );
  }

  protected async requestResetCode(): Promise<void> {
    this.error.set('');
    this.notice.set('');

    if (this.form.controls.email.invalid) {
      this.form.controls.email.markAsTouched();
      return;
    }

    const email = this.form.controls.email.value;
    this.busy.set(true);

    try {
      await this.auth.forgotPassword(email);
      this.notice.set('A reset code was sent to your email.');
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    this.notice.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const email = this.form.controls.email.value;
    const code = this.form.controls.code.value;
    const newPassword = this.form.controls.newPassword.value;
    const confirmPassword = this.form.controls.confirmPassword.value;

    if (newPassword !== confirmPassword) {
      this.form.controls.confirmPassword.markAsTouched();
      this.error.set('Both passwords must match.');
      return;
    }

    this.busy.set(true);

    try {
      await this.auth.resetPassword(email, code, newPassword);
      await this.router.navigate(['/login'], {
        queryParams: { reset: 'true', email },
      });
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
