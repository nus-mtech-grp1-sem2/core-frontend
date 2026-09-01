import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../core/cognito-gateway';
import { Events } from './events';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', groups, declaredRole: null };
}

async function renderFor(current: AuthenticatedUser | null) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [Events],
    providers: [
      provideRouter([]),
      {
        provide: CognitoGateway,
        useValue: { currentUser: async () => current, signOut: async () => undefined },
      },
    ],
  }).compileComponents();

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(Events);
  await fixture.whenStable();
  return fixture;
}

describe('Events', () => {
  it('lists every event with artwork and a price', async () => {
    const fixture = await renderFor(null);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.event-card').length).toBe(8);
    expect(host.querySelectorAll('.event-card img').length).toBe(8);
    expect(host.querySelector('.from-price')?.textContent).toContain('S$');
  });

  it('filters the grid by category', async () => {
    const fixture = await renderFor(null);
    const host = fixture.nativeElement as HTMLElement;

    const theatre = Array.from(host.querySelectorAll<HTMLButtonElement>('.chip')).find(
      (chip) => chip.textContent?.trim() === 'Theatre',
    );
    theatre?.click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.event-card').length).toBe(2);
    expect(host.querySelector('.count')?.textContent).toContain('2 events');
  });

  it('hides the New/Delete maintenance controls from non-admins', async () => {
    const fixture = await renderFor(user(['customer']));
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('#new-event-form')).toBeNull();
    expect(host.querySelectorAll('.delete').length).toBe(0);
  });

  it('lets an admin delete an event', async () => {
    const fixture = await renderFor(user(['organiser']));
    TestBed.inject(AuthService).setDemoRole('organiser');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('.delete').length).toBe(8);

    host.querySelector<HTMLButtonElement>('.delete')?.click();
    await fixture.whenStable();

    expect(host.querySelectorAll('.event-card').length).toBe(7);
  });
});

