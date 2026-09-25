import { execFileSync } from 'node:child_process';

const MYSQL_CONTAINER = 'onestage-local-mysql';
const EVENT_CONTAINER = 'event-service';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

/**
 * Refuses to run unless the backend is the disposable local compose stack. These tests create
 * events, orders and tickets, so they must never reach the shared AWS database or production.
 */
export function assertLocalStack(): void {
  let running: string;
  let dbHost: string;
  try {
    running = docker('inspect', '-f', '{{.State.Running}}', MYSQL_CONTAINER);
    dbHost =
      docker('inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', EVENT_CONTAINER)
        .split('\n')
        .find((line) => line.startsWith('DB_HOST='))
        ?.slice('DB_HOST='.length) ?? '';
  } catch {
    throw new Error(
      `Local backend not found. Start it first (see README): the ${MYSQL_CONTAINER} and ` +
        `${EVENT_CONTAINER} containers must be running.`,
    );
  }
  if (running !== 'true') {
    throw new Error(
      `The local ${MYSQL_CONTAINER} container is not running. Start the local backend.`,
    );
  }
  if (dbHost !== 'mysql') {
    throw new Error(
      `Refusing to run: ${EVENT_CONTAINER} uses DB_HOST=${JSON.stringify(dbHost)}, not the local ` +
        'mysql container. Full-stack tests only run against the local stack.',
    );
  }
}

/** Runs one SQL statement against the local MySQL container and returns the raw output. */
export function sql(statement: string): string {
  return docker(
    'exec',
    '-i',
    MYSQL_CONTAINER,
    'mysql',
    '-uroot',
    '-prootpassword',
    '--batch',
    '--skip-column-names',
    '-e',
    statement,
  );
}

/**
 * Stops a service container of the local stack for the duration of `body`, then starts it again
 * and waits for it to be healthy, even if `body` throws. Used to test recovery from an outage.
 * A failure in `body` is rethrown after the service is back, so it is never swallowed.
 */
export async function withServiceDown(container: string, body: () => Promise<void>): Promise<void> {
  docker('stop', container);
  let failure: unknown;
  try {
    await body();
  } catch (error) {
    failure = error;
  }

  docker('start', container);
  let healthy = false;
  for (let attempt = 0; attempt < 60 && !healthy; attempt += 1) {
    healthy = docker('inspect', '-f', '{{.State.Health.Status}}', container) === 'healthy';
    if (!healthy) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (failure !== undefined) throw failure;
  if (!healthy) throw new Error(`${container} did not become healthy again.`);
}
