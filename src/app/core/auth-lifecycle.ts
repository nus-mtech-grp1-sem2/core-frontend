import { Injectable, inject } from '@angular/core';
import { Hub } from 'aws-amplify/utils';

import { AuthService } from './auth';
import { RoleSyncService } from './role-sync';

/** Keeps Angular auth state synchronized with Amplify's redirect lifecycle. */
@Injectable({ providedIn: 'root' })
export class AuthLifecycleService {
  private readonly auth = inject(AuthService);
  private readonly roleSync = inject(RoleSyncService);
  private started = false;
  private currentSync: Promise<void> = Promise.resolve();

  initialise(): Promise<void> {
    if (!this.started) {
      this.started = true;
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedIn') {
          this.queueSync();
        }
      });
    }

    return this.queueSync();
  }

  private queueSync(): Promise<void> {
    this.currentSync = this.currentSync
      .then(() => this.sync())
      .catch((error: unknown) => {
        console.error('authentication lifecycle synchronization failed', error);
      });
    return this.currentSync;
  }

  private async sync(): Promise<void> {
    await this.auth.restore();
    if (!this.auth.isAuthenticated()) {
      return;
    }

    try {
      if (await this.roleSync.sync()) {
        await this.auth.refresh();
      }
    } catch (error) {
      console.warn('customer role sync unavailable; continuing with existing claims', error);
    }
  }
}
