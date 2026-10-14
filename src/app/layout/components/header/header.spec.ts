import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';

import { AuthService } from '../../../core/auth';
import { AuthenticatedUser, CognitoGateway } from '../../../core/cognito-gateway';
import { Header } from './header';

function user(groups: readonly string[]): AuthenticatedUser {
  return { sub: 's', email: 'someone@example.com', name: 'Someone Example', groups };
}

const stubRoutes: Routes = [
  { path: '', children: [] },
  { path: 'events', children: [] },
  { path: 'my-events', children: [] },
  { path: 'organiser', children: [] },
  { path: 'helper', children: [] },
  { path: 'checkin', children: [] },
];

async function navFor(current: AuthenticatedUser | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Header],
    providers: [
      provideRouter(stubRoutes),
      {
        provide: CognitoGateway,
        useValue: { currentUser: async () => current, signOut: async () => undefined },
      },
    ],
  });

  await TestBed.inject(AuthService).restore();
  const fixture = TestBed.createComponent(Header);
  await fixture.whenStable();

  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    router: TestBed.inject(Router),
  };
}

function tabLabels(host: HTMLElement): (string | undefined)[] {
  return Array.from(host.querySelectorAll('.tabs a')).map((a) => a.textContent?.trim());
}

function activeTab(host: HTMLElement): string | undefined {
  return host.querySelector('.tabs a.active')?.textContent?.trim();
}

describe('Header navigation', () => {
  it('offers the storefront to a signed-out visitor', async () => {
    const { host } = await navFor(null);

    const labels = Array.from(host.querySelectorAll('.primary a')).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toEqual(['Events']);
    expect(host.querySelector('.search')).not.toBeNull();
    expect(host.textContent).toContain('Login');
    expect(host.textContent).toContain('Register');
  });

  it('offers every signed-in account all three workspaces', async () => {
    const { host } = await navFor(user(['customer']));

    expect(tabLabels(host)).toEqual(['Customer', 'Organiser', 'Event helper']);
    expect(host.textContent).toContain('Sign out');
    expect(host.textContent).not.toContain('Login');
  });

  it('highlights Customer and shows search on the storefront', async () => {
    const { host } = await navFor(user(['customer']));

    expect(activeTab(host)).toBe('Customer');
    expect(host.querySelector('.search')).not.toBeNull();
  });

  it('highlights Organiser and hides search once there', async () => {
    const { host, router, fixture } = await navFor(user(['customer']));

    await router.navigateByUrl('/organiser');
    await fixture.whenStable();

    expect(activeTab(host)).toBe('Organiser');
    expect(host.querySelector('.search')).toBeNull();
  });

  it('highlights Event helper on both of its pages', async () => {
    const { host, router, fixture } = await navFor(user(['customer']));

    await router.navigateByUrl('/helper');
    await fixture.whenStable();
    expect(activeTab(host)).toBe('Event helper');

    await router.navigateByUrl('/checkin');
    await fixture.whenStable();
    expect(activeTab(host)).toBe('Event helper');
    expect(host.querySelector('.search')).toBeNull();
  });

  it('submits catalogue searches to the events page', async () => {
    const { host, router, fixture } = await navFor(null);
    const input = host.querySelector<HTMLInputElement>('#site-search')!;
    input.value = '  Test Hall  ';
    host
      .querySelector<HTMLFormElement>('form.search')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(router.url).toBe('/events?q=Test%20Hall');
  });

  it('filters the catalogue as the visitor types', async () => {
    const { host, router, fixture } = await navFor(null);
    const input = host.querySelector<HTMLInputElement>('#site-search')!;
    input.value = 'arena';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(router.url).toBe('/events?q=arena');
  });

  it('filters My events in place instead of sending the search to the catalogue', async () => {
    const { host, router, fixture } = await navFor(user(['customer']));
    await router.navigateByUrl('/my-events?orderId=42');
    await fixture.whenStable();
    const input = host.querySelector<HTMLInputElement>('#site-search')!;

    expect(input.placeholder).toBe('Search your tickets');
    expect(host.querySelector('label[for="site-search"]')?.textContent?.trim()).toBe(
      'Search your tickets by event or venue',
    );

    input.value = ' Test Hall ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(router.url).toBe('/my-events?orderId=42&q=Test%20Hall');

    host
      .querySelector<HTMLFormElement>('form.search')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(router.url).toBe('/my-events?orderId=42&q=Test%20Hall');

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(router.url).toBe('/my-events?orderId=42');
  });
});
