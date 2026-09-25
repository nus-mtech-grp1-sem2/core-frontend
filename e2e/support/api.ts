import type { Page, Request, Route } from '@playwright/test';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Body = Record<string, unknown> | unknown[];

export interface Reply {
  readonly status?: number;
  readonly json?: Body;
}

type Handler = Reply | ((request: Request) => Reply | Promise<Reply>);

interface Rule {
  readonly method: Method;
  readonly path: RegExp;
  readonly handler: Handler;
}

/**
 * Stubs the API gateway (`/api/<service>/...`) for one page.
 *
 * Anything not stubbed is answered with a 501 and recorded, so a test cannot
 * silently depend on a real backend (image requests excepted: they get a 404): call `expectNoUnhandled()` at the end (the
 * `api` fixture does this automatically). Later rules win over earlier ones.
 */
export class MockApi {
  private readonly rules: Rule[] = [];
  private readonly seen: Request[] = [];
  private readonly unhandled: string[] = [];

  /** `path` is matched against the URL path after `/api/` (e.g. `event/events`). */
  on(method: Method, path: string | RegExp, handler: Handler): this {
    const pattern = typeof path === 'string' ? new RegExp(`^${escape(path)}$`) : path;
    this.rules.unshift({ method, path: pattern, handler });
    return this;
  }

  /** Requests the app made that matched a rule, in order, e.g. to assert a call was NOT made. */
  requests(method: Method, path: string | RegExp): Request[] {
    const pattern = typeof path === 'string' ? new RegExp(`^${escape(path)}$`) : path;
    return this.seen.filter(
      (request) => request.method() === method && pattern.test(apiPath(request.url())),
    );
  }

  expectNoUnhandled(): void {
    if (this.unhandled.length > 0) {
      throw new Error(`Unmocked API calls:\n${this.unhandled.map((c) => `  ${c}`).join('\n')}`);
    }
  }

  async install(page: Page): Promise<void> {
    await page.route('**/api/**', (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const path = apiPath(request.url());
    const rule = this.rules.find(
      (candidate) => candidate.method === request.method() && candidate.path.test(path),
    );

    if (!rule && request.resourceType() === 'image') {
      // Artwork is loaded by <img>, not by app code; a 404 makes the app show its fallback image.
      await route.fulfill({ status: 404 });
      return;
    }

    if (!rule) {
      this.unhandled.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 501, json: { error: 'not_mocked' } });
      return;
    }

    this.seen.push(request);
    const reply = typeof rule.handler === 'function' ? await rule.handler(request) : rule.handler;
    await route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
  }
}

/** `http://localhost:4200/api/event/events?x=1` -> `event/events` */
function apiPath(url: string): string {
  return new URL(url).pathname.replace(/^\/api\//, '');
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
