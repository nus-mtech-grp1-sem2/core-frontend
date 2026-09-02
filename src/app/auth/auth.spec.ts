import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../core/api';
import { AuthService } from '../core/auth';
import { CognitoGateway, SignInResult } from '../core/cognito-gateway';
import { Confirm } from './confirm/confirm';
import { Login } from './login/login';
import { Register } from './register/register';

/** Stand-in for the SDK so the forms can be driven without a user pool. */
class FakeGateway implements Partial<CognitoGateway> {
  signInResult: SignInResult = { signedIn: true, nextStep: 'done' };
  signUpResult: SignInResult = { signedIn: false, nextStep: 'confirm-sign-up' };
  failWith: Error | null = null;

  readonly calls: string[] = [];

  async signIn(email: string): Promise<SignInResult> {
    this.calls.push(`signIn:${email}`);
    if (this.failWith) throw this.failWith;
    return this.signInResult;
  }

  async signUp(
    email: string,
    _password: string,
    _name: string,
    role: string,
  ): Promise<SignInResult> {
    this.calls.push(`signUp:${email}:${role}`);
    if (this.failWith) throw this.failWith;
    return this.signUpResult;
  }

  async confirmSignUp(email: string, code: string): Promise<boolean> {
    this.calls.push(`confirmSignUp:${email}:${code}`);
    if (this.failWith) throw this.failWith;
    return true;
  }

  async resendCode(email: string): Promise<void> {
    this.calls.push(`resendCode:${email}`);
    if (this.failWith) throw this.failWith;
  }

  async forgotPassword(email: string): Promise<void> {
    this.calls.push(`forgotPassword:${email}`);
    if (this.failWith) throw this.failWith;
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    this.calls.push(`resetPassword:${email}:${code}:${newPassword}`);
    if (this.failWith) throw this.failWith;
  }

  async currentUser() {
    return { sub: 'sub-1', email: 'fan@example.com', groups: ['customer'], declaredRole: null };
  }

  async accessToken() {
    return 'token';
  }

  async idToken() {
    return 'id-token';
  }

  async signOut(): Promise<void> {
    this.calls.push('signOut');
  }

  async refresh() {
    this.calls.push('refresh');
    return this.currentUser();
  }
}

class FakeApiService {
  readonly calls: string[] = [];

  post(service: string, path: string, body: unknown) {
    this.calls.push(`${service}:${path}:${JSON.stringify(body)}`);
    return of({});
  }
}

function typeInto(fixture: ComponentFixture<unknown>, selector: string, value: string): void {
  const input = (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submit(fixture: ComponentFixture<unknown>): void {
  const form = (fixture.nativeElement as HTMLElement).querySelector('form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit'));
}

/** Destinations the auth flow navigates to; the components themselves are not under test here. */
const stubRoutes: Routes = [
  { path: '', children: [] },
  { path: 'login', children: [] },
  { path: 'confirm', children: [] },
  { path: 'forgot-password', children: [] },
  { path: 'reset-password', children: [] },
];

function setup<T>(component: Type<T>, gateway: FakeGateway): ComponentFixture<T> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter(stubRoutes),
      { provide: CognitoGateway, useValue: gateway },
      { provide: ApiService, useClass: FakeApiService },
    ],
  });
  return TestBed.createComponent(component);
}

describe('Login', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<Login>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    fixture = setup(Login, gateway);
    await fixture.whenStable();
  });

  it('does not call Cognito when the form is invalid', async () => {
    submit(fixture);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.field-error').length).toBe(2);
    expect(gateway.calls).toEqual([]);
  });

  it('signs in and returns to the home page', async () => {
    typeInto(fixture, '#email', 'fan@example.com');
    typeInto(fixture, '#password', 'supersecret');
    submit(fixture);
    await fixture.whenStable();

    expect(gateway.calls).toContain('signIn:fan@example.com');
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('sends an unconfirmed account to the confirmation step', async () => {
    gateway.signInResult = { signedIn: false, nextStep: 'confirm-sign-up' };
    typeInto(fixture, '#email', 'fan@example.com');
    typeInto(fixture, '#password', 'supersecret');
    submit(fixture);
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toContain('/confirm');
  });

  it('shows a readable message when the password is wrong', async () => {
    gateway.failWith = Object.assign(new Error('bad'), { name: 'NotAuthorizedException' });
    typeInto(fixture, '#email', 'fan@example.com');
    typeInto(fixture, '#password', 'wrongpassword');
    submit(fixture);
    await fixture.whenStable();

    const banner = (fixture.nativeElement as HTMLElement).querySelector('.form-error-banner');
    expect(banner?.textContent).toContain('not correct');
  });

  it('routes a user who needs a password reset to the forgot-password flow', async () => {
    gateway.signInResult = { signedIn: false, nextStep: 'reset-password' };
    typeInto(fixture, '#email', 'fan@example.com');
    typeInto(fixture, '#password', 'supersecret');
    submit(fixture);
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toContain('/forgot-password');
    expect(TestBed.inject(Router).url).toContain('email=fan@example.com');
  });
});

describe('Register', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<Register>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    fixture = setup(Register, gateway);
    await fixture.whenStable();
  });

  function fillValidForm(): void {
    typeInto(fixture, '#name', 'Alex Tan');
    typeInto(fixture, '#email', 'alex@example.com');
    typeInto(fixture, '#password', 'supersecret');
    typeInto(fixture, '#confirmPassword', 'supersecret');
    const terms = (fixture.nativeElement as HTMLElement).querySelector(
      '[formControlName="acceptTerms"]',
    ) as HTMLInputElement;
    terms.checked = true;
    terms.dispatchEvent(new Event('change'));
  }

  it('flags mismatched passwords without calling Cognito', async () => {
    typeInto(fixture, '#name', 'Alex Tan');
    typeInto(fixture, '#email', 'alex@example.com');
    typeInto(fixture, '#password', 'supersecret');
    typeInto(fixture, '#confirmPassword', 'supersecrat');
    submit(fixture);
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#confirm-error')?.textContent,
    ).toContain('must match');
    expect(gateway.calls).toEqual([]);
  });

  it('requires the terms checkbox', async () => {
    typeInto(fixture, '#name', 'Alex Tan');
    typeInto(fixture, '#email', 'alex@example.com');
    typeInto(fixture, '#password', 'supersecret');
    typeInto(fixture, '#confirmPassword', 'supersecret');
    submit(fixture);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.terms-error')).not.toBeNull();
    expect(gateway.calls).toEqual([]);
  });

  it('registers and moves on to the confirmation step', async () => {
    fillValidForm();
    submit(fixture);
    await fixture.whenStable();

    expect(gateway.calls).toContain('signUp:alex@example.com:customer');
    expect(TestBed.inject(Router).url).toContain('/confirm');
    expect(TestBed.inject(Router).url).toContain('email=alex@example.com');
  });

  it('always registers a new user as a customer', async () => {
    fillValidForm();
    submit(fixture);
    await fixture.whenStable();

    expect(gateway.calls).toContain('signUp:alex@example.com:customer');
  });

  it('reports an email that is already registered', async () => {
    gateway.failWith = Object.assign(new Error('exists'), { name: 'UsernameExistsException' });
    fillValidForm();
    submit(fixture);
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.form-error-banner')?.textContent,
    ).toContain('already exists');
  });
});

describe('ForgotPassword', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<any>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    fixture = setup(
      (await import('./forgot-password/forgot-password')).ForgotPassword,
      gateway,
    );
    await fixture.whenStable();
  });

  it('requests a reset code and then confirms a new password in Cognito', async () => {
    typeInto(fixture, '#email', 'alex@example.com');
    const requestButton = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="request-reset-code"]',
    ) as HTMLButtonElement;
    requestButton.click();
    await fixture.whenStable();

    expect(gateway.calls).toContain('forgotPassword:alex@example.com');

    typeInto(fixture, '#code', '654321');
    typeInto(fixture, '#newPassword', 'brandnewpass');
    typeInto(fixture, '#confirmPassword', 'brandnewpass');
    const submitButton = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="confirm-reset-password"]',
    ) as HTMLButtonElement;
    submitButton.click();
    await fixture.whenStable();

    expect(gateway.calls).toContain('resetPassword:alex@example.com:654321:brandnewpass');
    expect(TestBed.inject(Router).url).toContain('/login');
    expect(TestBed.inject(Router).url).toContain('reset=true');
  });
});

describe('Confirm', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<Confirm>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    fixture = setup(Confirm, gateway);
    await fixture.whenStable();
  });

  it('confirms the code and sends the visitor to a fresh sign-in', async () => {
    typeInto(fixture, '#email', 'alex@example.com');
    typeInto(fixture, '#code', '123456');
    const auth = TestBed.inject(AuthService);
    auth.rememberRegistration('alex@example.com', 'Alex Tan', 'supersecret');
    const api = TestBed.inject(ApiService) as unknown as FakeApiService;
    submit(fixture);
    await fixture.whenStable();

    expect(gateway.calls).toContain('confirmSignUp:alex@example.com:123456');
    expect(api.calls).toContain('auth:/users:{"name":"Alex Tan","email":"alex@example.com"}');
    expect(gateway.calls).not.toContain('signIn:alex@example.com');
    expect(TestBed.inject(Router).url).toContain('/login');
    expect(TestBed.inject(Router).url).toContain('confirmed=true');
  });

  it('explains a wrong code', async () => {
    gateway.failWith = Object.assign(new Error('nope'), { name: 'CodeMismatchException' });
    typeInto(fixture, '#email', 'alex@example.com');
    typeInto(fixture, '#code', '000000');
    TestBed.inject(AuthService).rememberRegistration('alex@example.com', 'Alex Tan', 'supersecret');
    submit(fixture);
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.form-error-banner')?.textContent,
    ).toContain('not correct');
  });

  it('resends a code on request', async () => {
    typeInto(fixture, '#email', 'alex@example.com');
    (
      (fixture.nativeElement as HTMLElement).querySelector('.linklike') as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(gateway.calls).toContain('resendCode:alex@example.com');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.form-notice')?.textContent,
    ).toContain('new code');
  });
});
