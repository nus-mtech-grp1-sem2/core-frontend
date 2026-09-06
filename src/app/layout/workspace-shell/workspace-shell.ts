import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../core/auth';

interface SidebarLink {
  readonly label: string;
  readonly path: string;
}

type Workspace = 'customer' | 'organiser' | 'event-helper';

const LINKS_BY_WORKSPACE: Readonly<Record<Workspace, readonly SidebarLink[]>> = {
  customer: [
    { label: 'Events', path: '/events' },
    { label: 'My events', path: '/my-events' },
  ],
  organiser: [
    { label: 'Dashboard', path: '/organiser' },
    { label: 'Events', path: '/organiser/events' },
    { label: 'Sales', path: '/organiser/sales' },
    { label: 'Attendees', path: '/organiser/attendees' },
  ],
  'event-helper': [
    { label: 'Home', path: '/helper' },
    { label: 'Check-in', path: '/checkin' },
  ],
};

/**
 * Secondary nav for the three areas of OneStage: a dark sidebar next to the
 * page content, listing that area's own pages. The top header still carries
 * the workspace switcher and account actions — this only adds the section
 * list each area now has enough pages to need.
 *
 * Every signed-in account can open any of the three (see `authGuard`), so
 * the links shown are simply whichever area the host page says it belongs
 * to — not something derived from the account itself. The customer area's
 * pages are public, though, so its sidebar only appears once someone is
 * actually signed in — a visitor just browsing gets the plain storefront nav
 * in the header instead.
 */
@Component({
  selector: 'app-workspace-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="workspace">
      @if (showSidebar()) {
        <aside class="sidebar" aria-label="Workspace navigation">
          <nav>
            <ul>
              @for (link of links(); track link.path) {
                <li>
                  <a [routerLink]="link.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{
                    link.label
                  }}</a>
                </li>
              }
            </ul>
          </nav>
        </aside>
      }

      <div class="content">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .workspace {
      display: flex;
      align-items: stretch;
      min-height: calc(100dvh - 4rem - 1px);
    }

    .sidebar {
      flex: 0 0 13rem;
      background: var(--ink-900);
      padding: 1.5rem 1rem;
    }

    .sidebar nav ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }

    .sidebar a {
      display: block;
      padding: 0.625rem 0.75rem;
      border-radius: var(--radius-sm);
      color: var(--text-inverse-muted);
      text-decoration: none;
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .sidebar a:hover {
      color: var(--text-inverse);
    }

    .sidebar a.active {
      background: var(--brand-500);
      color: var(--text-inverse);
    }

    .content {
      flex: 1;
      min-width: 0;
    }

    @media (max-width: 720px) {
      .workspace {
        flex-direction: column;
        min-height: 0;
      }

      .sidebar {
        flex-basis: auto;
      }

      .sidebar nav ul {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
    }
  `,
})
export class WorkspaceShell {
  private readonly auth = inject(AuthService);

  /** Which area's page list to show — set by the page hosting this shell. */
  readonly workspace = input.required<Workspace>();

  protected readonly links = computed(() => LINKS_BY_WORKSPACE[this.workspace()]);

  protected readonly showSidebar = computed(
    () => this.workspace() !== 'customer' || this.auth.isAuthenticated(),
  );
}
