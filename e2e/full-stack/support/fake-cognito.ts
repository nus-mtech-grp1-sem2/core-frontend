import { join } from 'node:path';

import { userSub } from './auth';
import { containerEnv, docker, recreateServices } from './stack';
import { credentials, type Role } from './users';

const EVENT_CONTAINER = 'event-service';
const STUB_CONTAINER = 'fake-cognito';
const STUB_DIR = join(__dirname, '..', 'fake-cognito');
const ENDPOINT_VARIABLE = 'AWS_ENDPOINT_URL_COGNITO_IDENTITY_PROVIDER';

/** What the stand-in Cognito can be asked, as the event service would ask it. */
export interface FakeCognito {
  /** Every Cognito operation the event service has called, in order. */
  calls(): { operation: string; input: Record<string, unknown> }[];
  /** While failing, every Cognito call answers with a server error. */
  setFailing(failing: boolean): void;
}

/**
 * Points the event service at a stand-in for Cognito that knows `roles` (the real users' subs and
 * emails, so their real tokens match), for the invitation flow: the event service normally
 * looks the invitee up in Cognito, which needs AWS credentials. Nothing here has any.
 *
 * Call `stopFakeCognito` afterwards (in `afterAll`) to put the event service back.
 */
export async function startFakeCognito(roles: readonly Role[]): Promise<FakeCognito> {
  const users = roles.map((role) => ({
    sub: userSub(role),
    email: credentials(role).email,
    name: `E2E ${role.charAt(0).toUpperCase()}${role.slice(1)}`,
  }));
  await recreateServices(
    EVENT_CONTAINER,
    ['fake-cognito', 'event'],
    {
      FAKE_COGNITO_IMAGE: docker('inspect', '-f', '{{.Config.Image}}', EVENT_CONTAINER),
      FAKE_COGNITO_DIR: STUB_DIR,
      FAKE_COGNITO_USERS: JSON.stringify(users),
    },
    [join(STUB_DIR, 'compose.yml')],
  );

  const ask = (script: string) => docker('exec', STUB_CONTAINER, 'node', '-e', script);
  return {
    calls: () =>
      (
        JSON.parse(
          ask("fetch('http://127.0.0.1:9229/__calls').then((r) => r.text()).then(console.log)"),
        ) as { calls: { operation: string; input: Record<string, unknown> }[] }
      ).calls,
    setFailing: (failing) => {
      ask(
        `fetch('http://127.0.0.1:9229/__failing', { method: 'POST', body: '{"failing":${failing}}' })`,
      );
    },
  };
}

/** Puts the event service back on the stack's own settings and removes the stand-in. Safe to repeat. */
export async function stopFakeCognito(): Promise<void> {
  await recreateServices(EVENT_CONTAINER, ['event']);
  docker('rm', '-f', STUB_CONTAINER);
  if (containerEnv(EVENT_CONTAINER, ENDPOINT_VARIABLE)) {
    throw new Error('The event service still points at the fake Cognito.');
  }
}
