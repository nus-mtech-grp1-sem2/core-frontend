import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService, describeAuthError } from '../../core/auth';
import { AuthShell } from '../auth-shell/auth-shell';

/** Group validator: the two password fields must match. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return !confirm || password === confirm ? null : { mismatch: true };
}

/** Account creation form, backed by the Cognito user pool. */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthShell, ReactiveFormsModule, RouterLink],
  template: `
    <app-auth-shell
      heading="Create your account"
      lead="One account for tickets, order history and presale access."
      image="images/hero-stadium.jpg"
      alt="Packed stadium during an evening match"
      quote="Be first in the queue, every time."
    >
      @if (error()) {
        <p class="form-error-banner" role="alert">{{ error() }}</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="name">Full name</label>
          <input
            id="name"
            type="text"
            autocomplete="name"
            formControlName="name"
            [attr.aria-invalid]="invalid('name')"
            [attr.aria-describedby]="invalid('name') ? 'name-error' : null"
          />
          @if (invalid('name')) {
            <p class="field-error" id="name-error">Enter your name as it appears on your ID.</p>
          }
        </div>

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
              autocomplete="new-password"
              formControlName="password"
              [attr.aria-invalid]="invalid('password')"
              aria-describedby="password-hint"
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
          <p class="field-hint" id="password-hint">At least 8 characters.</p>
          @if (invalid('password')) {
            <p class="field-error">Your password must be at least 8 characters.</p>
          }
        </div>

        <div class="field">
          <label for="confirmPassword">Confirm password</label>
          <div class="password-control">
            <input
              id="confirmPassword"
              [type]="showConfirmPassword() ? 'text' : 'password'"
              autocomplete="new-password"
              formControlName="confirmPassword"
              [attr.aria-invalid]="mismatch()"
              [attr.aria-describedby]="mismatch() ? 'confirm-error' : null"
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
            <p class="field-error" id="confirm-error">Both passwords must match.</p>
          }
        </div>

        <label class="checkbox">
          <input
            type="checkbox"
            formControlName="acceptTerms"
            [attr.aria-invalid]="invalid('acceptTerms')"
          />
          <span>I agree to the terms of sale and the privacy policy.</span>
        </label>
        @if (invalid('acceptTerms')) {
          <p class="field-error terms-error">You need to accept the terms to continue.</p>
        }

        <button class="btn btn-primary submit" type="submit" [disabled]="busy()">
          {{ busy() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="alt-action">Already have an account? <a routerLink="/login">Sign in</a></p>
    </app-auth-shell>
  `,
  styles: `
    .roles {
      border: 0;
      padding: 0;
      margin: 0 0 1.25rem;
      display: grid;
      gap: 0.5rem;
    }

    legend {
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0;
      margin-bottom: 0.5rem;
    }

    .role-option {
      display: flex;
      align-items: flex-start;
      gap: 0.625rem;
      padding: 0.75rem 0.875rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      cursor: pointer;
    }

    .role-option.selected {
      border-color: var(--brand-500);
      background: var(--brand-soft);
    }

    .role-option input {
      margin-top: 0.2rem;
      accent-color: var(--brand-500);
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

    .role-name {
      display: block;
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .role-detail {
      display: block;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .submit {
      width: 100%;
      margin-top: 0.5rem;
    }

    .terms-error {
      margin-top: -0.5rem;
      margin-bottom: 1rem;
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
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** True once the visitor has pressed submit, so errors stay hidden until then. */
  protected readonly attempted = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]],
    },
    { validators: passwordsMatch },
  );

  protected invalid(control: 'name' | 'email' | 'password' | 'acceptTerms'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || this.attempted());
  }

  protected mismatch(): boolean {
    const confirm = this.form.controls.confirmPassword;
    const show = confirm.touched || this.attempted();
    return show && (confirm.invalid || this.form.hasError('mismatch'));
  }

  protected async submit(): Promise<void> {
    this.attempted.set(true);
    this.error.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, email, password } = this.form.getRawValue();
    this.busy.set(true);

    try {
      const step = await this.auth.signUp(email, password, name, 'customer');
      this.auth.rememberRegistration(email, name, password);

      // A pool that verifies by email always lands here: Cognito has created
      // the user but it cannot sign in until the emailed code is entered.
      await this.router.navigate(['/confirm'], {
        queryParams: { email, name, ...(step === 'done' ? { confirmed: 'true' } : {}) },
      });
    } catch (err) {
      this.error.set(describeAuthError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
