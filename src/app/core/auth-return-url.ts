import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

const RETURN_URL_KEY = 'onestage:auth-return-url';

/**
 * Accepts only paths on the current origin. The explicit prefix and backslash
 * checks reject protocol-relative URLs before URL normalisation can reinterpret
 * them as another origin.
 */
export function safeReturnUrl(value: string | null, origin: string): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }

  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** Keeps the destination across Cognito's redirect without persisting it beyond this tab. */
@Injectable({ providedIn: 'root' })
export class AuthReturnUrlService {
  private readonly view = inject(DOCUMENT).defaultView;

  remember(value: string | null): void {
    const storage = this.view?.sessionStorage;
    if (!storage || !this.view) return;

    const destination = safeReturnUrl(value, this.view.location.origin);
    if (destination) {
      storage.setItem(RETURN_URL_KEY, destination);
    } else {
      storage.removeItem(RETURN_URL_KEY);
    }
  }

  take(): string | null {
    const storage = this.view?.sessionStorage;
    if (!storage || !this.view) return null;

    const value = storage.getItem(RETURN_URL_KEY);
    storage.removeItem(RETURN_URL_KEY);
    return safeReturnUrl(value, this.view.location.origin);
  }
}
