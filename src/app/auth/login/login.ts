import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService, describeAuthError } from '../../core/auth';
import { UserRole } from '../../core/roles';
import { AuthShell } from '../auth-shell/auth-shell';

/** Sign-in form, backed by the Cognito user pool. */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell, ReactiveFormsModule, RouterLink],
  template: `
    <app-auth-shell
      heading="Welcome back"
      lead="Sign in to see your orders, saved events and presale codes."
      image="images/hero-theatre.jpg"
      alt="Silhouetted performers against a red stage curtain"
      quote="Your seats are waiting."
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
          <label for="password">Password</label>
          <div class="password-control">
            <input
              id="password"
              [type]="showPassword() ? 'text' : 'password'"
              autocomplete="current-password"
              formControlName="password"
              [attr.aria-invalid]="invalid('password')"
              [attr.aria-describedby]="invalid('password') ? 'password-error' : null"
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
          @if (invalid('password')) {
            <p class="field-error" id="password-error">
              Your password must be at least 8 characters.
            </p>
          }
        </div>

        <fieldset class="login-type-group" aria-label="Demo login type">
          <legend>Login as</legend>
          <label class="login-option">
            <input type="radio" formControlName="loginType" value="customer" />
            <span>Customer</span>
          </label>
          <label class="login-option">
            <input type="radio" formControlName="loginType" value="event-helper" />
            <span>Event Helper</span>
          </label>
          <label class="login-option">
            <input type="radio" formControlName="loginType" value="organiser" />
            <span>Admin</span>
          </label>
        </fieldset>

        <div class="row">
          <label class="checkbox">
            <input type="checkbox" formControlName="remember" />
            <span>Keep me signed in</span>
          </label>
          <a class="link" routerLink="/register">Need an account?</a>
        </div>

        <p class="secondary-action">
          <a class="link" routerLink="/forgot-password">Forgot password?</a>
        </p>

        <button class="btn btn-primary submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="alt-action">New to OneStage? <a routerLink="/register">Create an account</a></p>
    </app-auth-shell>
  `,
  styles: `
    .login-type-group {
      border: 0;
      margin: 0 0 1.25rem;
      padding: 0;
      display: grid;
      gap: 0.625rem;
    }

    .login-type-group legend {
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .login-option {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      background: var(--surface);
      cursor: pointer;
    }

    .login-option input {
      accent-color: var(--brand-500);
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.25rem;
    }

    .row .checkbox {
      margin-bottom: 0;
    }

    .secondary-action {
      margin-bottom: 1.25rem;
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

    .link,
    .alt-action a {
      color: var(--brand-600);
      font-size: 0.875rem;
      font-weight: 600;
      text-decoration: none;
    }

    .link:hover,
    .alt-action a:hover {
      text-decoration: underline;
    }

    .submit {
      width: 100%;
    }

    .alt-action {
      margin-top: 1.5rem;
      font-size: 0.9375rem;
      color: var(--text-muted);
    }
  `,
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** True once the visitor has pressed submit, so errors stay hidden until then. */
  protected readonly attempted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly showPassword = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    loginType: ['customer' as UserRole, [Validators.required]],
    remember: [false],
  });

  constructor() {
    const params = this.router.parseUrl(this.router.url).queryParams;
    if (params['confirmed'] === 'true') {
      const email = typeof params['email'] === 'string' ? params['email'] : '';
      this.notice.set(
        email
          ? `Your account is confirmed. Sign in with ${email} to continue.`
          : 'Your account is confirmed. Please sign in with your new credentials.',
      );
      if (email) {
        this.form.controls.email.setValue(email);
      }
    }

    if (params['reset'] === 'true') {
      const email = typeof params['email'] === 'string' ? params['email'] : '';
      this.notice.set(
        email
          ? `Your password was reset. Sign in with ${email} using your new password.`
          : 'Your password was reset. Please sign in with your new password.',
      );
      if (email) {
        this.form.controls.email.setValue(email);
      }
    }
  }

  protected invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || this.attempted());
  }

  protected async submit(): Promise<void> {
    this.attempted.set(true);
    this.error.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password, loginType } = this.form.getRawValue();
    this.busy.set(true);

    try {
      const step = await this.auth.signIn(email, password);

      if (step === 'confirm-sign-up') {
        // Signed up but never confirmed: send them to finish that first.
        await this.router.navigate(['/confirm'], { queryParams: { email } });
        return;
      }

      if (step === 'reset-password') {
        await this.router.navigate(['/forgot-password'], { queryParams: { email } });
        return;
      }

      if (step !== 'done') {
        this.error.set('This account needs a sign-in step that is not supported yet.');
        return;
      }

      this.auth.setDemoRole(loginType);
      await this.router.navigateByUrl(this.returnUrl());
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Where the guard wanted to send them, defaulting to the home page. */
  private returnUrl(): string {
    const url = this.router.parseUrl(this.router.url).queryParams['returnUrl'];
    return typeof url === 'string' && url.startsWith('/') ? url : '/';
  }
}
