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

Tests must not commit credentials, tokens or saved auth state. `test-results/`,
`playwright-report/` and `e2e/.auth/` are gitignored.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
