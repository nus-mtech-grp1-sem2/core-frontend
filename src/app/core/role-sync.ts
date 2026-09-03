import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api';

interface SyncResponse {
  readonly role: string;
  readonly groups: readonly string[];
  readonly changed: boolean;
}

/**
 * Asks the auth service to ensure a self-registered user belongs to the
 * customer Cognito group.
 *
 * The browser cannot do this itself — group membership is an admin API — so the
 * service does it against the token we send. It never grants a privileged
 * group. The call is idempotent and a no-op once the user is in any group.
 */
@Injectable({ providedIn: 'root' })
export class RoleSyncService {
  private readonly api = inject(ApiService);

  /** Returns true when a group was newly granted, so the caller can refresh. */
  async sync(): Promise<boolean> {
    const result = await firstValueFrom(this.api.post<SyncResponse>('auth', '/roles/sync', {}));
    return result.changed;
  }
}
