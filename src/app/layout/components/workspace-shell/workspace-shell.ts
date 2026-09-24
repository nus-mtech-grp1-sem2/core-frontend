import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../../core/auth';

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
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.css',
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
