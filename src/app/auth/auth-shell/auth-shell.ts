import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Two-column frame shared by the login and register pages. */
@Component({
  selector: 'app-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <section class="auth">
      <div class="art">
        <img [ngSrc]="image()" [alt]="alt()" fill sizes="(max-width: 900px) 100vw, 45vw" />
        <div class="art-copy">
          <p class="quote">{{ quote() }}</p>
          <p class="attribution">OneStage</p>
        </div>
      </div>

      <div class="pane">
        <div class="card">
          <h1>{{ heading() }}</h1>
          <p class="lead">{{ lead() }}</p>
          <ng-content />
        </div>
      </div>
    </section>
  `,
  styles: `
    .auth {
      display: grid;
      grid-template-columns: 45fr 55fr;
      min-height: calc(100dvh - 4rem);
    }

    .art {
      position: relative;
      display: grid;
      align-items: end;
      background: var(--ink-900);
      overflow: hidden;
    }

    .art img {
      object-fit: cover;
    }

    .art-copy {
      position: relative;
      z-index: 1;
      padding: clamp(1.5rem, 4vw, 3rem);
      color: var(--text-inverse);
      background: linear-gradient(180deg, rgba(10, 10, 18, 0) 0%, rgba(10, 10, 18, 0.9) 70%);
    }

    .quote {
      font-family: var(--font-display);
      font-size: clamp(1.125rem, 2.2vw, 1.5rem);
      max-width: 24ch;
      line-height: 1.3;
    }

    .attribution {
      margin-top: 0.5rem;
      font-size: 0.8125rem;
      color: var(--text-inverse-muted);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .pane {
      display: grid;
      place-items: center;
      padding: clamp(1.5rem, 5vw, 3.5rem) clamp(1rem, 4vw, 2rem);
    }

    .card {
      width: 100%;
      max-width: 26rem;
    }

    h1 {
      font-size: clamp(1.5rem, 3vw, 2rem);
    }

    .lead {
      margin: 0.5rem 0 1.5rem;
      color: var(--text-muted);
      font-size: 0.9375rem;
    }

    @media (max-width: 900px) {
      .auth {
        grid-template-columns: 1fr;
      }

      .art {
        min-height: 12rem;
      }
    }
  `,
})
export class AuthShell {
  readonly heading = input.required<string>();
  readonly lead = input.required<string>();
  readonly image = input('images/hero-concert.jpg');
  readonly alt = input('Crowd at a live concert');
  readonly quote = input('Front row seats to the moments worth queueing for.');
}
