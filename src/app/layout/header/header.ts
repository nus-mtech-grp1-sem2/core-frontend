import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../core/auth';
import { ROLE_LABELS, UserRole } from '../../core/roles';

interface NavLink {
  readonly label: string;
  readonly path: string;
}

/** Sticky top bar: brand, primary nav, search and account actions. */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="bar">
      <div class="inner">
        <a class="brand" routerLink="/">
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
          <span class="wordmark">OneStage</span>
        </a>

        <button
          type="button"
          class="toggle"
          [attr.aria-expanded]="menuOpen()"
          aria-controls="primary-nav"
          (click)="toggleMenu()"
        >
          <span class="visually-hidden">Toggle navigation</span>
          <span class="bars" aria-hidden="true"></span>
        </button>

        <div class="collapsible" id="primary-nav" [class.open]="menuOpen()">
          <nav class="primary" aria-label="Main">
            <ul>
              @for (link of links(); track link.path) {
                <li>
                  <a
                    [routerLink]="link.path"
                    routerLinkActive="active"
                    [routerLinkActiveOptions]="{ exact: true }"
                    >{{ link.label }}</a
                  >
                </li>
              }
            </ul>
          </nav>

          @if (showSearch()) {
            <search class="search">
            <label class="visually-hidden" for="site-search"
              >Search events, venues or artists</label
            >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none">
              <circle cx="11" cy="11" r="6.25" stroke="currentColor" stroke-width="1.6" />
              <path
                d="m16 16 4 4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
              <input id="site-search" type="search" placeholder="Search events, venues, artists" />
            </search>
          }

          <div class="account">
            @if (auth.isAuthenticated()) {
              <span class="who" title="{{ auth.user()?.email }}">
                {{ auth.user()?.email }}
                <span class="role">{{ roleLabel() }}</span>
              </span>
              <button class="btn btn-ghost btn-sm" type="button" (click)="signOut()">
                Sign out
              </button>
            } @else {
              <a class="btn btn-ghost btn-sm" routerLink="/login">Login</a>
              <a class="btn btn-primary btn-sm" routerLink="/register">Register</a>
            }
          </div>
        </div>
      </div>
    </header>
  `,
  styles: `
    .bar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(10, 10, 18, 0.92);
      backdrop-filter: blur(10px);
      color: var(--text-inverse);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    /* Full width rather than the page column: the brand sits against the left
       edge and the account actions against the right, however wide the screen. */
    .inner {
      display: flex;
      align-items: center;
      gap: clamp(0.75rem, 2vw, 2rem);
      min-height: 4rem;
      width: 100%;
      padding-inline: clamp(1rem, 2.5vw, 2.5rem);
      flex-wrap: wrap;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: inherit;
      text-decoration: none;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--brand-500), var(--accent-500));
      color: #fff;
    }

    .wordmark {
      font-family: var(--font-display);
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .collapsible {
      display: contents;
    }

    .primary ul {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .primary a {
      position: relative;
      color: var(--text-inverse-muted);
      text-decoration: none;
      font-size: 0.9375rem;
      font-weight: 500;
      padding: 0.25rem 0;
      transition: color 0.15s ease;
    }

    .primary a:hover,
    .primary a.active {
      color: var(--text-inverse);
    }

    .primary a.active::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -0.35rem;
      height: 2px;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--brand-400), var(--accent-500));
    }

    .search {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4375rem 0.875rem;
      min-width: 12rem;
      max-width: 28rem;
      flex: 1 1 12rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: var(--text-inverse-muted);
    }

    .search:focus-within {
      border-color: var(--brand-400);
      background: rgba(255, 255, 255, 0.12);
    }

    .search input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: 0;
      color: var(--text-inverse);
      font: inherit;
      font-size: 0.875rem;
    }

    .search input::placeholder {
      color: var(--text-inverse-muted);
    }

    .search input:focus {
      outline: none;
    }

    .account {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-inline-start: auto;
    }

    .role {
      display: inline-block;
      margin-inline-start: 0.375rem;
      padding: 0.0625rem 0.4375rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--text-inverse);
      vertical-align: 1px;
    }

    .who {
      max-width: 20rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      color: var(--text-inverse-muted);
    }

    .toggle {
      display: none;
      margin-inline-start: auto;
      width: 2.5rem;
      height: 2.5rem;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.24);
      border-radius: 10px;
      color: inherit;
      cursor: pointer;
      position: relative;
    }

    .bars,
    .bars::before,
    .bars::after {
      position: absolute;
      left: 50%;
      width: 1.125rem;
      height: 2px;
      background: currentColor;
      border-radius: 2px;
      transform: translateX(-50%);
    }

    .bars {
      top: 50%;
      transform: translate(-50%, -50%);
    }

    .bars::before {
      content: '';
      top: -6px;
    }

    .bars::after {
      content: '';
      top: 6px;
    }

    @media (max-width: 900px) {
      .search {
        display: none;
      }
    }

    @media (max-width: 1080px) {
      .who {
        max-width: 11rem;
      }
    }

    @media (max-width: 860px) {
      /* The address is the least useful thing here once space is tight — the
         role badge and sign out still say who you are signed in as. */
      .who {
        display: none;
      }
    }

    @media (max-width: 720px) {
      .toggle {
        display: block;
      }

      .collapsible {
        display: none;
        width: 100%;
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
        padding-bottom: 1rem;
      }

      .collapsible.open {
        display: flex;
      }

      .primary ul {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.75rem;
      }

      .account {
        margin-inline-start: 0;
        width: 100%;
      }

      .account .btn {
        flex: 1;
      }

      .who {
        display: inline;
        max-width: 100%;
      }
    }
  `,
})
export class Header {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);

  /**
   * What each kind of user has any use for. Staff do not get the storefront
   * links and shoppers do not get the workspace ones, so the bar only ever
   * offers what the signed-in role can actually do.
   */
  private readonly navByRole: Readonly<Record<'anonymous' | UserRole, readonly NavLink[]>> = {
    anonymous: [
      { label: 'Events', path: '/events' },
      { label: 'Tickets', path: '/tickets' },
    ],
    customer: [
      { label: 'Events', path: '/events' },
      { label: 'Tickets', path: '/tickets' },
    ],
    organiser: [{ label: 'Dashboard', path: '/organiser' }],
    'event-helper': [
      { label: 'My shifts', path: '/helper' },
    ],
  };

  protected readonly links = computed(() => this.navByRole[this.auth.role() ?? 'anonymous']);

  /** Search is for browsing the catalogue, which is not what staff are here for. */
  protected readonly showSearch = computed(() => {
    const role = this.auth.role();
    return role === null || role === 'customer';
  });

  /** Human-readable role for the badge next to the signed-in email. */
  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
