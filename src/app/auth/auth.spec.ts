import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CognitoGateway } from '../core/cognito-gateway';
import { Login } from './components/login/login';
import { Register } from './components/register/register';

class FakeGateway implements Partial<CognitoGateway> {
  failWith: Error | null = null;
  calls = 0;
  signUpCalls = 0;

  async signIn(): Promise<void> {
    this.calls += 1;
    if (this.failWith) {
      throw this.failWith;
    }
  }

  async signUp(): Promise<void> {
    this.signUpCalls += 1;
    if (this.failWith) {
      throw this.failWith;
    }
  }
}

describe('Login', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<Login>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: CognitoGateway, useValue: gateway }],
    });
    fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
  });

  it('starts Cognito Managed Login', async () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();

    expect(gateway.calls).toBe(1);
  });

  it('reports a redirect failure', async () => {
    gateway.failWith = new Error('redirect failed');
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.form-error-banner')?.textContent,
    ).toContain('Something went wrong');
  });
});

describe('Register', () => {
  let gateway: FakeGateway;
  let fixture: ComponentFixture<Register>;

  beforeEach(async () => {
    gateway = new FakeGateway();
    TestBed.configureTestingModule({
      imports: [Register],
      providers: [{ provide: CognitoGateway, useValue: gateway }],
    });
    fixture = TestBed.createComponent(Register);
    await fixture.whenStable();
  });

  it('starts Cognito Managed Login on the sign-up screen', async () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();

    expect(gateway.signUpCalls).toBe(1);
  });

  it('reports a redirect failure', async () => {
    gateway.failWith = new Error('redirect failed');
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    button?.click();
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.form-error-banner')?.textContent,
    ).toContain('Something went wrong');
  });
});
