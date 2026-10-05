import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Hub } from 'aws-amplify/utils';

import { AuthService } from './auth';
import { AuthReturnUrlService } from './auth-return-url';

/** Keeps Angular auth state synchronized with Amplify's redirect lifecycle. */
@Injectable({ providedIn: 'root' })
export class AuthLifecycleService {
  private readonly auth = inject(AuthService);
  private readonly returnUrl = inject(AuthReturnUrlService);
  private readonly router = inject(Router);
  private started = false;
  private currentRestore: Promise<void> = Promise.resolve();

  initialise(): Promise<void> {
    if (!this.started) {
      this.started = true;
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedIn') {
          this.queueRestore(true);
        }
      });
    }

    return this.queueRestore();
  }

  private queueRestore(redirectAfterSignIn = false): Promise<void> {
    this.currentRestore = this.currentRestore
      .then(() => this.auth.restore())
      .then(async () => {
        if (!redirectAfterSignIn || !this.auth.isAuthenticated()) return;
        const destination = this.returnUrl.take();
        if (destination) await this.router.navigateByUrl(destination);
      })
      .catch((error: unknown) => {
        console.error('authentication lifecycle synchronization failed', error);
      });
    return this.currentRestore;
  }
}
