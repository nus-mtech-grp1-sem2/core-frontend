import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AuthService } from '../core/auth';
import { HelperHome } from '../helper/helper-home';
import { Organiser } from '../organiser/organiser';
import { Home } from './home';

/**
 * The landing page at `/`, which differs by role.
 *
 * Staff get their workspace, everyone else gets the storefront. Keeping one URL
 * means a shared link, a bookmark or the brand logo works for every kind of
 * user, and nobody has to remember which path is theirs.
 */
@Component({
  selector: 'app-role-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Home, HelperHome, Organiser],
  template: `
    @switch (auth.role()) {
      @case ('organiser') {
        <app-organiser />
      }
      @case ('event-helper') {
        <app-helper-home />
      }
      @default {
        <app-home />
      }
    }
  `,
})
export class RoleHome {
  protected readonly auth = inject(AuthService);
}
