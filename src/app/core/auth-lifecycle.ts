import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Hub } from 'aws-amplify/utils';

import { AuthService } from './auth';
import { AuthCallbackFeedbackService } from './auth-callback-feedback';
import { AuthReturnUrlService } from './auth-return-url';

const RESTORE_TIMEOUT_MS = 5_000;

/** Keeps Angular auth state synchronized with Amplify's redirect lifecycle. */
@Injectable({ providedIn: 'root' })
export class AuthLifecycleService {
  private readonly auth = inject(AuthService);
  private readonly callbackFeedback = inject(AuthCallbackFeedbackService);
  private readonly returnUrl = inject(AuthReturnUrlService);
  private readonly router = inject(Router);
  private started = false;
  private callbackFailure: Promise<void> = Promise.resolve();
  private resolveCallbackFailure: (() => void) | null = null;

  initialise(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.callbackFailure = new Promise((resolve) => {
        this.resolveCallbackFailure = resolve;
      });
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedIn') {
          void this.restoreAfterSignIn();
        }
        if (payload.event === 'signInWithRedirect_failure') {
          this.callbackFeedback.recordCurrentFailure();
          this.auth.completeAsAnonymous();
          this.resolveCallbackFailure?.();
        }
      });
    }

    return this.restoreForStartup();
  }

  private async restoreForStartup(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        console.warn('authentication restore timed out; continuing signed out');
        this.auth.completeAsAnonymous();
        resolve();
      }, RESTORE_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.restore(), this.callbackFailure, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async restoreAfterSignIn(): Promise<void> {
    await this.restore();
    if (!this.auth.isAuthenticated()) return;

    const destination = this.returnUrl.take();
    if (destination) await this.router.navigateByUrl(destination);
  }

  private async restore(): Promise<void> {
    try {
      await this.auth.restore();
    } catch (error: unknown) {
      console.error('authentication lifecycle synchronization failed', error);
      this.auth.completeAsAnonymous();
    }
  }
}
