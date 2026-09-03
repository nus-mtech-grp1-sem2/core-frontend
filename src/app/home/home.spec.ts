import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Home } from './home';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders every image with a local src and alt text', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const images = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
    ) as HTMLImageElement[];

    expect(images.length).toBe(9);
    for (const img of images) {
      expect(img.getAttribute('src')).toMatch(/^images\/[\w-]+\.jpg$/);
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(0);
    }
  });

  it('keeps sign-up marketing out of the way of a signed-in customer', async () => {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    // Signed out: the pitch is the point.
    expect(host.querySelector('.assurances')).not.toBeNull();
    expect(host.querySelector('.cta')).not.toBeNull();
  });
});
