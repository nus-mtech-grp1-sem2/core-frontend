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
npm run test:e2e        # headless: the `mocked`, `mocked-camera` and `mobile` projects
npm run test:e2e:ui     # Playwright UI mode
npx playwright show-report
```

The `mocked-camera` project runs `e2e/camera-checkin.e2e.ts` in Chromium launched with a fake camera
(`--use-fake-device-for-media-stream`) that films a ticket's QR code, so the door's camera scanner
runs for real while the ticket service is stubbed. Its setup step writes the video
(`e2e/.fixtures/ticket-qr.y4m`, gitignored) by hand, since Playwright's bundled ffmpeg cannot encode
one. Camera errors (denied, missing, unsupported) are simulated by making `getUserMedia` fail.
QR image quality cases (small, low contrast, cropped, not an image, over 12 MB) are in
`e2e/helper-checkin.e2e.ts`; `support/qr-images` degrades a generated QR with a canvas in the page.

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
- `accessibility.e2e.ts` runs axe over the pages and states that have no spec of their own (home, sign
  in, event page in each waiting-room state, the door screen after every scan result, the organiser
  pages and the seat-map editor) and checks keyboard use. axe finds only some problems, so things it
  cannot see (a focus indicator on an invisible input, a state with no `aria-pressed`) are tested by
  hand-written checks. A test that documents a known bug is marked `test.fail` with its issue number.

The `mobile` project (`e2e/mobile.e2e.ts`) runs a phone-sized, touch-enabled Chromium (Pixel 7).
It checks that each screen people use on a phone does not scroll sideways at 412, 360 and 320 px
wide and on its side, that buttons and fields are at least 24 px (WCAG 2.2 AA), that the navigation
menu opens with a tap, and that choosing seats, buying, checking a ticket in and working the camera
all work with `tap()` rather than mouse clicks. Known layout bugs are marked `test.fail`.

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
- **Event management:** the seat-map editor driven with the real mouse (draw, move, resize, save,
  and the saved layout comes back; adding zones once on sale; a zone with a sold seat cannot be
  removed or shrunk, in the page and at the API); a draft is edited, given a photo and is not public;
  deleting a draft asks first; publishing locks the details and cancelling takes it off sale
  (orders refused, editor locked) until it is re-published. Team roles (`team-roles.e2e.ts`, with the
  stand-in Cognito): a helper has no say over the event, a promoted organiser gets the controls but
  is not an owner, demoting takes them away, removing takes away scanner access.
- **Known bugs are marked `test.fail`:** a test that asserts the correct behaviour of something
  currently broken, with the issue number. It passes while the bug exists and starts failing when
  it is fixed, which is the cue to delete the marker.
- **Automatic admission:** the queue service is recreated with the scheduler on and short timings
  (admission lasts 8 s, interval 15 s, one buyer at a time). The first customer is admitted with
  nobody pressing "Admit next customer" and their page moves on to seat selection; the second waits
  while the first admission is live; when it expires the slot frees but the second still waits out
  the interval; then they are admitted at least an interval after the first.
- **Team invitations:** the organiser invites a helper by email and sees "Helper · pending" with a
  name; a pending invitation grants no scanner access and nobody but the invitee can answer it;
  accepting puts the helper on the roster and lets them open the door; rejecting grants nothing and
  cannot be undone by answering again; an unknown email or a second invitation is refused and adds
  nobody; an unavailable Cognito fails the invitation cleanly, the roster still loads, and it
  recovers.
- **Backend rules, checked at the API:** an admission token buys once and an expired one is refused;
  malformed orders create nothing; the last ticket cannot be sold twice; paying twice at once charges
  and issues once; a payment made while the ticket service is down is recovered by paying again;
  the same ticket scanned at the same moment is accepted once.

Choices worth knowing about:

- `backend-env.sh` turns **automatic waiting-room admission off** so the tests decide when customers
  are admitted. With it on, a scheduler admits a customer about a second after they join, so the
  organiser's "Admit next customer" and the queue position could not be tested reliably. Only
  `admission-scheduler.e2e.ts` turns it on, by recreating the `queue-service` container with
  `docker compose` (using the project, files and env file compose recorded on the container, so it
  works wherever the stack was started) and recreating it again afterwards, even if the test fails.
  Run that spec on its own and the stack ends as it began.
- The outage test **stops and restarts the `ticket-service` container** of the local stack.
- The suite bumps the local order counter so order ids have at least two digits: the door's search
  ignores queries shorter than two characters.
- Attendee names are seeded by the lookup test. The ticket service builds a name from
  `given_name`/`family_name` on the access token, which Cognito does not include, so no ticket has a
  name today and the door shows the email instead.
- The event service looks invitees up in Cognito, which needs AWS credentials. Only
  `team-invitations.e2e.ts` gets around that, by recreating `event-service` pointed at a **stand-in
  Cognito** (`e2e/full-stack/fake-cognito/`: a dependency-free Node server, run in the backend's own
  image, that answers `ListUsers` and `AdminGetUser` for the four test accounts, using their real
  subs so their real tokens match). The AWS SDK is redirected with
  `AWS_ENDPOINT_URL_COGNITO_IDENTITY_PROVIDER`, with dummy credentials; nothing in the backend
  changes. This proves our side of the flow, not real Cognito's answers. The stack is put back
  afterwards (`afterAll`); if a run is killed halfway, run the spec again or recreate
  `event-service` to restore it.
- The gateway (`kong-gateway`) is restarted whenever a service is recreated: it keeps the address it
  first resolved, so a recreated container would otherwise answer 502.

The local database keeps data between runs (each run creates its own uniquely named event). To
reset it, run the backend's `docker compose ... down -v` and start it again. Confirmation prompts
(`window.confirm`) are part of the real flows: Playwright dismisses dialogs unless a test accepts
them.

Tests must not commit credentials, tokens or saved auth state. `test-results/`,
`playwright-report/` and `e2e/.auth/` are gitignored.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
