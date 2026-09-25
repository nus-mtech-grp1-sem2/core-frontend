# CoreFrontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.20.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

End-to-end tests use [Playwright](https://playwright.dev/) and live in `e2e/`, named `*.e2e.ts`
(not `.spec.ts`, which `ng test` would pick up). Playwright starts `npm start` itself, or reuses a
dev server already running on port 4200. The port matters: the Cognito app client only allows
`http://localhost:4200/` as a callback URL.

One-time browser install (Chromium only for now):

```bash
npx playwright install chromium
# On a fresh Linux machine or CI runner, also install system libraries:
npx playwright install --with-deps chromium
```

Then:

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI mode
npx playwright show-report
```

### Writing tests

Import `test`/`expect` from `e2e/support/fixtures`, not from `@playwright/test`:

- `signInAs(page, customer | helper | organiser)` (`support/session`) fakes a signed-in session
  with an unsigned test token, before `page.goto`. It never contacts Cognito and is useless
  against a real backend.
- `api.on('GET', 'event/events', { json: ... })` stubs a gateway call (path after `/api/`).
  Any API call you did not stub fails the test, so a test can never silently hit a real backend.
  `api.requests(...)` lets you assert what the app did (or did not) send.
- `expectAccessible(page)` (`support/a11y`) runs axe against WCAG 2.x A/AA; call it once the
  page shows real content.
- Build responses with the factories in `support/data`.

### Full-stack tier

`npm run test:e2e:full` drives the real app against the real local backend and real Cognito sign-in
(`e2e/full-stack/`). It is separate from the hermetic tier that CI runs (`npm run test:e2e`).

Prerequisites:

1. **Local backend** in the sibling `backend-repo`, started with the local MySQL override (see its
   `infrastructure/README.md`). It needs no AWS credentials. The tests refuse to run unless the
   `event-service` container uses the local `mysql` container, so they can never reach the shared
   AWS database.
2. **Test accounts.** Four Cognito users (`e2e-customer`, `e2e-customer2`, `e2e-organiser`,
   `e2e-helper` `@example.com`) exist in the shared pool. Their passwords go in the gitignored
   `e2e/.auth/users.env` as `E2E_<ROLE>_PASSWORD` (roles `CUSTOMER`, `CUSTOMER2`, `ORGANISER`,
   `HELPER`), or in the environment. Get them from a teammate; never commit or paste them.
3. Playwright serves the app on port 4200, the only callback the Cognito app client allows.

How it works: a setup project signs each account in through Cognito Managed Login once and saves the
session under `e2e/.auth/` (gitignored, owner-only); the journey then runs in order against one
event. Organiser/helper are per-event roles, so the helper is assigned by inserting the accepted
membership row into the local database (the normal invitation needs AWS access to look the user up).
The event's inventory is set through the API the seat-map editor calls, since that editor is a
drag-to-draw canvas.

The local database keeps data between runs (each run creates its own uniquely named event). To
reset it, run the backend's `docker compose ... down -v` and start it again. Confirmation prompts
(`window.confirm`) are part of the real flows: Playwright dismisses dialogs unless a test accepts
them.

Tests must not commit credentials, tokens or saved auth state. `test-results/`,
`playwright-report/` and `e2e/.auth/` are gitignored.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
