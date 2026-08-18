import { InjectionToken } from '@angular/core';

/** The backend services routed by the Kong gateway. */
export type BackendService =
  'auth' | 'event' | 'inventory' | 'queue' | 'order' | 'ticket' | 'notification';

/**
 * Root of the API. Everything goes through the Kong gateway, which routes
 * `/api/<service>/...` to the right service, so there is exactly one URL to
 * configure — no per-service ports on this side.
 *
 * The default is a same-origin `/api` path that the dev server forwards to Kong
 * on localhost:8000 (see proxy.conf.json), so the browser makes no cross-origin
 * request in development. For a deployed build, override this token in
 * `appConfig` with the public gateway URL.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
