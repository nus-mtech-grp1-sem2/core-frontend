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

What it covers (`e2e/full-stack/`):

- **Ticketing journey:** organiser creates and publishes an event through the UI; a customer buys
  tickets; the door scans a QR image (valid, already used, unreadable, and a valid ticket for a
  _different_ event is refused as the wrong event); manual lookup by name, email and order id, scoped
  to the event; the organiser's sales, attendees, team roster and check-in progress; only an event's
  organisers can manage it (customers and helpers get 403, no token gets 401).
- **Reserved seating:** waiting room positions, rejoining keeps one place, the organiser admits
  customers, a genuine race for one seat (exactly one wins, the other picks another), checkout, and
  no seat is issued twice.
- **Backend rules, checked at the API:** an admission token buys once and an expired one is refused;
  malformed orders create nothing; the last ticket cannot be sold twice; paying twice at once charges
  and issues once; a payment made while the ticket service is down is recovered by paying again;
  the same ticket scanned at the same moment is accepted once.

Choices worth knowing about:

- `backend-env.sh` turns **automatic waiting-room admission off** so the tests decide when customers
  are admitted. With it on, a scheduler admits a customer about a second after they join, so the
  organiser's "Admit next customer" and the queue position could not be tested reliably. The
  scheduler itself is therefore not covered here.
- The outage test **stops and restarts the `ticket-service` container** of the local stack.
- The suite bumps the local order counter so order ids have at least two digits: the door's search
  ignores queries shorter than two characters.
- Attendee names are seeded by the lookup test. The ticket service builds a name from
  `given_name`/`family_name` on the access token, which Cognito does not include, so no ticket has a
  name today and the door shows the email instead.
- Not covered: the helper invitation and acceptance flow (the invitation looks the user up in
  Cognito and needs AWS access), the camera scanner, and QR images that are cropped or low contrast.

The local database keeps data between runs (each run creates its own uniquely named event). To
reset it, run the backend's `docker compose ... down -v` and start it again. Confirmation prompts
(`window.confirm`) are part of the real flows: Playwright dismisses dialogs unless a test accepts
them.

Tests must not commit credentials, tokens or saved auth state. `test-results/`,
`playwright-report/` and `e2e/.auth/` are gitignored.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
