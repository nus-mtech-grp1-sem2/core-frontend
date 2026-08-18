import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api';

interface SyncResponse {
  readonly role: string;
  readonly groups: readonly string[];
  readonly changed: boolean;
}

/**
 * Asks the auth service to grant the Cognito group for the role this user chose
 * at sign-up.
 *
 * The browser cannot do this itself — group membership is an admin API — so the
 * service does it against the token we send. Idempotent, and a no-op once the
 * user is in a group, so calling it on every sign-in is fine.
 */
@Injectable({ providedIn: 'root' })
export class RoleSyncService {
  private readonly api = inject(ApiService);

  /** Returns true when a group was newly granted, so the caller can refresh. */
  async sync(): Promise<boolean> {
    const result = await firstValueFrom(
      this.api.post<SyncResponse>('auth', '/roles/sync', {}),
    );
    return result.changed;
  }
}
