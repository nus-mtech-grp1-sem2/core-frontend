import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { Checkin } from './checkin';

const helper: AuthenticatedUser = {
  sub: 's',
  email: 'helper@example.com',
  groups: ['event-helper'],
  declaredRole: null,
};

function typeCode(fixture: ComponentFixture<Checkin>, value: string): void {
  const input = (fixture.nativeElement as HTMLElement).querySelector('#code') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submit(fixture: ComponentFixture<Checkin>): void {
  const form = (fixture.nativeElement as HTMLElement).querySelector('form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit'));
}

async function setup(): Promise<ComponentFixture<Checkin>> {
  TestBed.configureTestingModule({
    imports: [Checkin],
    providers: [
      provideRouter([]),
      { provide: CognitoGateway, useValue: { currentUser: async () => helper } },
    ],
  });

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(Checkin);
  await fixture.whenStable();
  return fixture;
}

describe('Checkin', () => {
  it('shows the signed-in helper', async () => {
    const fixture = await setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('helper@example.com');
    expect(host.textContent).toContain('No tickets scanned yet.');
  });

  it('admits a known ticket code', async () => {
    const fixture = await setup();
    typeCode(fixture, 'TKT-1001');
    submit(fixture);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.verdict.ok')?.textContent).toContain('admitted');
    expect(host.querySelectorAll('.log li').length).toBe(1);
  });

  it('flags a code scanned twice as a duplicate', async () => {
    const fixture = await setup();
    typeCode(fixture, 'TKT-1001');
    submit(fixture);
    await fixture.whenStable();
    typeCode(fixture, 'tkt-1001');
    submit(fixture);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.verdict.warn')?.textContent).toContain('already scanned');
    expect(host.querySelectorAll('.log li').length).toBe(2);
  });

  it('rejects a code that is not in the sample catalogue', async () => {
    const fixture = await setup();
    typeCode(fixture, 'TKT-9999');
    submit(fixture);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.verdict.bad')?.textContent).toContain('not a valid ticket');
  });

  it('does nothing when the code field is left blank', async () => {
    const fixture = await setup();
    submit(fixture);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.verdict')).toBeNull();
    expect(host.textContent).toContain('No tickets scanned yet.');
  });
});
