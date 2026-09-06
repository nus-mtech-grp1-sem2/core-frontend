import { Injectable, inject } from '@angular/core';
import { Hub } from 'aws-amplify/utils';

import { AuthService } from './auth';

/** Keeps Angular auth state synchronized with Amplify's redirect lifecycle. */
@Injectable({ providedIn: 'root' })
export class AuthLifecycleService {
  private readonly auth = inject(AuthService);
  private started = false;
  private currentRestore: Promise<void> = Promise.resolve();

  initialise(): Promise<void> {
    if (!this.started) {
      this.started = true;
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedIn') {
          this.queueRestore();
        }
      });
    }

    return this.queueRestore();
  }

  private queueRestore(): Promise<void> {
    this.currentRestore = this.currentRestore
      .then(() => this.auth.restore())
      .catch((error: unknown) => {
        console.error('authentication lifecycle synchronization failed', error);
      });
    return this.currentRestore;
  }
}
