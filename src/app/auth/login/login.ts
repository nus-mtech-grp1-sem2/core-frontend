import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService, describeAuthError } from '../../core/auth';
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
          <input
            id="password"
            type="password"
            autocomplete="current-password"
            formControlName="password"
            [attr.aria-invalid]="invalid('password')"
            [attr.aria-describedby]="invalid('password') ? 'password-error' : null"
          />
          @if (invalid('password')) {
            <p class="field-error" id="password-error">
              Your password must be at least 8 characters.
            </p>
          }
        </div>

        <div class="row">
          <label class="checkbox">
            <input type="checkbox" formControlName="remember" />
            <span>Keep me signed in</span>
          </label>
          <a class="link" routerLink="/register">Need an account?</a>
        </div>

        <button class="btn btn-primary submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="alt-action">New to OneStage? <a routerLink="/register">Create an account</a></p>
    </app-auth-shell>
  `,
  styles: `
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

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    remember: [false],
  });

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

    const { email, password } = this.form.getRawValue();
    this.busy.set(true);

    try {
      const step = await this.auth.signIn(email, password);

      if (step === 'confirm-sign-up') {
        // Signed up but never confirmed: send them to finish that first.
        await this.router.navigate(['/confirm'], { queryParams: { email } });
        return;
      }

      if (step !== 'done') {
        this.error.set('This account needs a sign-in step that is not supported yet.');
        return;
      }

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
