import { execFileSync } from 'node:child_process';

const MYSQL_CONTAINER = 'onestage-local-mysql';
const EVENT_CONTAINER = 'event-service';
const QUEUE_CONTAINER = 'queue-service';

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

/** The value of an environment variable inside a running container of the local stack. */
function containerEnv(container: string, name: string): string | undefined {
  return docker('inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container)
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Recreates one service of the local stack, with `env` overriding the compose file's defaults. */
function recreateService(container: string, service: string, env: Record<string, string>): void {
  // Compose records how it started each container, so the stack is recreated exactly the way the
  // developer or workflow started it, without the tests having to know where the backend lives.
  const labels = JSON.parse(
    docker('inspect', '-f', '{{json .Config.Labels}}', container),
  ) as Record<string, string>;
  const files = labels['com.docker.compose.project.config_files']?.split(',') ?? [];
  const envFile = labels['com.docker.compose.project.environment_file'];
  if (!labels['com.docker.compose.project'] || files.length === 0) {
    throw new Error(`${container} was not started by docker compose, so it cannot be recreated.`);
  }
  execFileSync(
    'docker',
    [
      'compose',
      '--project-name',
      labels['com.docker.compose.project'],
      '--project-directory',
      labels['com.docker.compose.project.working_dir'],
      ...files.flatMap((file) => ['-f', file]),
      ...(envFile ? ['--env-file', envFile] : []),
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      service,
    ],
    // Variables set here win over the .env file when compose fills in `${VAR:-default}`.
    { env: { ...process.env, ...env }, stdio: 'pipe' },
  );
}

/**
 * Runs `body` with the queue service recreated using `settings` (for example
 * `AUTO_ADMISSION_ENABLED: 'true'`), then recreates it again with the stack's own settings, even
 * if `body` throws. The rest of the tier runs with the automatic admission scheduler off so the
 * tests decide when customers are admitted; this is the one place that turns it on.
 */
export async function withQueueSettings(
  settings: Record<string, string>,
  body: () => Promise<void>,
): Promise<void> {
  const original = Object.fromEntries(
    Object.keys(settings).map((name) => [name, containerEnv(QUEUE_CONTAINER, name)]),
  );

  let failure: unknown;
  try {
    recreateService(QUEUE_CONTAINER, 'queue', settings);
    await body();
  } catch (error) {
    failure = error;
  }

  // Put the queue back exactly as it was, whatever happened above.
  const restoreEnv = Object.fromEntries(
    Object.entries(original).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  recreateService(QUEUE_CONTAINER, 'queue', restoreEnv);
  for (const [name, value] of Object.entries(original)) {
    if (containerEnv(QUEUE_CONTAINER, name) !== value) {
      throw new Error(`The queue service was not restored: ${name} should be ${value}.`);
    }
  }
  if (failure !== undefined) throw failure;
}
