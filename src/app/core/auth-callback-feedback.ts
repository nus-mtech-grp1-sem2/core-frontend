import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

const CALLBACK_ERROR_KEY = 'onestage:auth-callback-error';

export function describeAuthCallbackError(code: string | null): string {
  return code === 'access_denied'
    ? 'Sign-in was cancelled.'
    : 'Sign-in could not be completed. Please try again.';
}

/** Transfers a trusted Amplify callback failure to the login screen once. */
@Injectable({ providedIn: 'root' })
export class AuthCallbackFeedbackService {
  private readonly view = inject(DOCUMENT).defaultView;

  recordCurrentFailure(): boolean {
    if (!this.view) return false;
    const callbackUrl = new URL(this.view.location.href);
    if (!callbackUrl.searchParams.has('error')) return false;
    this.view.sessionStorage.setItem(
      CALLBACK_ERROR_KEY,
      describeAuthCallbackError(callbackUrl.searchParams.get('error')),
    );
    this.view.history.replaceState(this.view.history.state, '', '/login');
    return true;
  }

  take(): string {
    const storage = this.view?.sessionStorage;
    if (!storage) return '';
    const message = storage.getItem(CALLBACK_ERROR_KEY) ?? '';
    storage.removeItem(CALLBACK_ERROR_KEY);
    return message;
  }
}
