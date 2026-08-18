import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { FEATURED_SLIDES } from '../../core/catalog';

const ROTATE_MS = 7000;

/**
 * Hero slideshow for featured events. Rotation pauses while the pointer or
 * keyboard focus is inside the carousel, and never starts when the visitor
 * prefers reduced motion.
 */
@Component({
  selector: 'app-carousel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, RouterLink],
  host: {
    '(mouseenter)': 'pause()',
    '(mouseleave)': 'resume()',
    '(focusin)': 'pause()',
    '(focusout)': 'resume()',
  },
  templateUrl: './carousel.html',
  styleUrl: './carousel.css',
})
export class Carousel {
  private readonly view = inject(DOCUMENT).defaultView;

  protected readonly slides = FEATURED_SLIDES;
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.slides[this.index()]);

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.resume();
    inject(DestroyRef).onDestroy(() => this.pause());
  }

  protected next(): void {
    this.index.update((i) => (i + 1) % this.slides.length);
  }

  protected previous(): void {
    this.index.update((i) => (i - 1 + this.slides.length) % this.slides.length);
  }

  protected select(i: number): void {
    this.index.set(i);
  }

  protected pause(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  protected resume(): void {
    if (this.timer !== undefined || this.prefersReducedMotion()) {
      return;
    }
    this.timer = setInterval(() => this.next(), ROTATE_MS);
  }

  private prefersReducedMotion(): boolean {
    // `matchMedia` is missing outside a browser (tests, server rendering); treat
    // that as "reduce" so no timer is started there.
    if (typeof this.view?.matchMedia !== 'function') {
      return true;
    }
    return this.view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
