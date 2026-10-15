import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';

describe('site navigation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  for (const [label, path, destination = path] of [
    ['Login', '/login'],
    ['Register', '/register'],
    ['Events', '/events'],
  ] as const) {
    it(`navigates to ${path} when the ${label} link is clicked`, async () => {
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/');
      await fixture.whenStable();

      const link = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('app-header a'),
      ).find((anchor) => anchor.textContent?.trim() === label);

      expect(link, `no header link labelled ${label}`).toBeTruthy();
      expect(link?.getAttribute('href')).toBe(path);

      link?.click();
      await fixture.whenStable();

      expect(TestBed.inject(Location).path()).toBe(destination);
    });
  }

  it('keeps the home account CTA and footer contact link working', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    const cta = Array.from(host.querySelectorAll<HTMLAnchorElement>('a')).find(
      (anchor) => anchor.textContent?.trim() === 'Create an account',
    );
    expect(cta?.getAttribute('href')).toBe('/register');

    expect(host.querySelector('app-footer a')?.getAttribute('href')).toBe(
      'mailto:onestagecontacts@gmail.com',
    );
  });
});
