import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthService } from '../../../core/auth';
import { QueuePlacesService } from '../../../core/queue-places';

interface NavLink {
  readonly label: string;
  readonly path: string;
}

type Workspace = 'customer' | 'organiser' | 'event-helper';

interface WorkspaceTab {
  readonly key: Workspace;
  readonly label: string;
  readonly path: string;
}

/** Where each workspace lives, in the order the tabs are shown. */
const WORKSPACE_TABS: readonly WorkspaceTab[] = [
  { key: 'customer', label: 'Customer', path: '/' },
  { key: 'organiser', label: 'Organiser', path: '/organiser' },
  { key: 'event-helper', label: 'Event helper', path: '/helper' },
];

const ANONYMOUS_LINKS: readonly NavLink[] = [{ label: 'Events', path: '/events' }];

interface SearchScope {
  /** The page whose list the search filters. */
  readonly path: string;
  readonly label: string;
  readonly placeholder: string;
}

const CATALOGUE_SEARCH: SearchScope = {
  path: '/events',
  label: 'Search events, venues or artists',
  placeholder: 'Search events, venues, artists',
};

/** On My events the search filters the customer's own tickets rather than the catalogue. */
const MY_TICKETS_SEARCH: SearchScope = {
  path: '/my-events',
  label: 'Search your tickets by event or venue',
  placeholder: 'Search your tickets',
};

/**
 * Sticky top bar: brand, primary nav, search and account actions.
 *
 * Every signed-in account can use all three areas of OneStage — there is no
 * per-role restriction — so once someone is signed in the primary nav becomes
 * a switcher between the three, rather than a fixed set of links picked for
 * them. Signed-out visitors still just get the storefront links.
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  protected readonly auth = inject(AuthService);
  private readonly queuePlaces = inject(QueuePlacesService);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);
  protected readonly tabs = WORKSPACE_TABS;
  protected readonly anonymousLinks = ANONYMOUS_LINKS;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Which of the three workspaces the current URL belongs to. */
  protected readonly activeWorkspace = computed<Workspace>(() => {
    const url = this.currentUrl();
    if (url.startsWith('/organiser')) {
      return 'organiser';
    }
    if (url.startsWith('/helper') || url.startsWith('/checkin')) {
      return 'event-helper';
    }
    return 'customer';
  });

  /** Search is for browsing the catalogue, which the other two workspaces do not need. */
  protected readonly showSearch = computed(
    () => !this.auth.isAuthenticated() || this.activeWorkspace() === 'customer',
  );
  protected readonly searchScope = computed(() =>
    this.currentUrl().split(/[?#]/)[0] === MY_TICKETS_SEARCH.path
      ? MY_TICKETS_SEARCH
      : CATALOGUE_SEARCH,
  );
  protected readonly searchQuery = computed(() => {
    const query = this.currentUrl().split('?')[1] ?? '';
    return new URLSearchParams(query).get('q') ?? '';
  });

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected search(input: HTMLInputElement): void {
    this.runSearch(input.value, false);
  }

  protected searchAsYouType(value: string): void {
    this.runSearch(value, true);
  }

  private runSearch(value: string, replaceUrl: boolean): void {
    const query = value.trim();
    this.menuOpen.set(false);
    if (this.searchScope() === MY_TICKETS_SEARCH) {
      // Filter in place, keeping the page's own parameters (e.g. the orderId
      // a purchase lands with) and not stacking a history entry per keystroke.
      void this.router.navigate([MY_TICKETS_SEARCH.path], {
        queryParams: { q: query || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }
    void this.router.navigate([CATALOGUE_SEARCH.path], {
      queryParams: query ? { q: query } : {},
      replaceUrl,
    });
  }

  protected async signOut(): Promise<void> {
    this.queuePlaces.forgetLocalPlaces();
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
