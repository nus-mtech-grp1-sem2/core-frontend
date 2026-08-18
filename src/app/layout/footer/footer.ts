import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Site footer. Link targets are placeholders until those pages exist. */
@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <footer class="footer">
      <div class="shell top">
        <div class="brand">
          <span class="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path
                d="M4 8.5A2.5 2.5 0 0 0 6.5 6h11A2.5 2.5 0 0 0 20 8.5v1a2.5 2.5 0 0 0 0 5v1A2.5 2.5 0 0 0 17.5 18h-11A2.5 2.5 0 0 0 4 15.5v-1a2.5 2.5 0 0 0 0-5v-1Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <path
                d="M12 7.5v9"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-dasharray="2 2.5"
              />
            </svg>
          </span>
          <p class="name">OneStage</p>
          <p class="tagline">
            Concerts, sports and theatre tickets across Singapore and the region.
          </p>
        </div>

        <nav class="columns" aria-label="Footer">
          @for (column of columns; track column.title) {
            <div>
              <h2>{{ column.title }}</h2>
              <ul>
                @for (item of column.items; track item.label) {
                  <li>
                    @if (item.path) {
                      <a [routerLink]="item.path">{{ item.label }}</a>
                    } @else {
                      <a href="#">{{ item.label }}</a>
                    }
                  </li>
                }
              </ul>
            </div>
          }
        </nav>
      </div>

      <div class="shell bottom">
        <p>© 2026 OneStage. Sample content for demonstration.</p>
        <ul class="legal">
          <li><a href="#">Privacy</a></li>
          <li><a href="#">Terms</a></li>
          <li><a href="#">Accessibility</a></li>
        </ul>
      </div>
    </footer>
  `,
  styles: `
    .footer {
      background: var(--ink-900);
      color: var(--text-inverse-muted);
      padding-block: clamp(2.5rem, 5vw, 3.5rem) 1.5rem;
    }

    .top {
      display: grid;
      grid-template-columns: minmax(16rem, 1fr) auto;
      gap: 2.5rem;
      padding-bottom: 2rem;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
      color: #fff;
      margin-bottom: 0.75rem;
    }

    .name {
      font-family: var(--font-display);
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--text-inverse);
    }

    .tagline {
      margin-top: 0.375rem;
      font-size: 0.875rem;
      max-width: 26rem;
    }

    .columns {
      display: flex;
      flex-wrap: wrap;
      gap: 3rem;
    }

    h2 {
      font-family: var(--font-sans);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-inverse);
      margin-bottom: 0.75rem;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }

    a {
      color: inherit;
      text-decoration: none;
      font-size: 0.875rem;
    }

    a:hover {
      color: var(--text-inverse);
      text-decoration: underline;
    }

    .bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      padding-top: 1.25rem;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.8125rem;
    }

    .legal {
      display: flex;
      gap: 1.25rem;
    }

    @media (max-width: 760px) {
      .top {
        grid-template-columns: 1fr;
        gap: 2rem;
      }

      .columns {
        gap: 2rem;
      }
    }
  `,
})
export class Footer {
  protected readonly columns = [
    {
      title: 'Discover',
      items: [
        { label: 'Concerts', path: '/events' },
        { label: 'Sports', path: '/events' },
        { label: 'Theatre', path: '/events' },
        { label: 'All tickets', path: '/tickets' },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Sign in', path: '/login' },
        { label: 'Create an account', path: '/register' },
        { label: 'Order status', path: null },
        { label: 'Refunds', path: null },
      ],
    },
    {
      title: 'Company',
      items: [
        { label: 'About', path: null },
        { label: 'Careers', path: null },
        { label: 'Partners', path: null },
        { label: 'Press', path: null },
      ],
    },
  ] as const;
}
