import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MYSQL_CONTAINER = 'onestage-local-mysql';
const EVENT_CONTAINER = 'event-service';
const QUEUE_CONTAINER = 'queue-service';
const GATEWAY_CONTAINER = 'kong-gateway';

let dockerPath: string | undefined;

/**
 * The docker CLI by absolute path, so a writable directory on PATH cannot shadow it.
 * DOCKER_PATH overrides the standard install locations below.
 */
function dockerBin(): string {
  if (dockerPath) return dockerPath;
  const candidates = [
    process.env['DOCKER_PATH'],
    '/usr/bin/docker',
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`,
  ];
  const found = candidates.find((path): path is string => !!path && existsSync(path));
  if (!found) throw new Error('docker CLI not found; set DOCKER_PATH to its absolute path.');
  dockerPath = found;
  return found;
}

export function docker(...args: string[]): string {
  return execFileSync(dockerBin(), args, { encoding: 'utf8' }).trim();
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

/** Waits until a container of the local stack reports healthy. */
async function waitHealthy(container: string): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (docker('inspect', '-f', '{{.State.Health.Status}}', container) === 'healthy') return true;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
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
export function containerEnv(container: string, name: string): string | undefined {
  return docker('inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container)
    .split('\n')
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * Recreates services of the local stack, with `env` overriding the compose file's defaults and
 * `extraFiles` (compose files of our own) layered on top of the ones the stack was started with.
 */
export async function recreateServices(
  container: string,
  services: readonly string[],
  env: Record<string, string> = {},
  extraFiles: readonly string[] = [],
): Promise<void> {
  // Compose records how it started each container, so the stack is recreated exactly the way the
  // developer or workflow started it, without the tests having to know where the backend lives.
  const labels = JSON.parse(
    docker('inspect', '-f', '{{json .Config.Labels}}', container),
  ) as Record<string, string>;
  // A container we recreated earlier lists our own compose files too; start from the stack's own.
  const ours = join(__dirname, '..', '..');
  const files = (labels['com.docker.compose.project.config_files']?.split(',') ?? []).filter(
    (file) => !file.startsWith(ours),
  );
  const envFile = labels['com.docker.compose.project.environment_file'];
  if (!labels['com.docker.compose.project'] || files.length === 0) {
    throw new Error(`${container} was not started by docker compose, so it cannot be recreated.`);
  }
  execFileSync(
    dockerBin(),
    [
      'compose',
      '--project-name',
      labels['com.docker.compose.project'],
      '--project-directory',
      labels['com.docker.compose.project.working_dir'],
      ...[...files, ...extraFiles].flatMap((file) => ['-f', file]),
      ...(envFile ? ['--env-file', envFile] : []),
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      ...services,
    ],
    // Variables set here win over the .env file when compose fills in `${VAR:-default}`.
    { env: { ...process.env, ...env }, stdio: 'pipe' },
  );

  // The gateway resolves each service's address once and keeps it, but a recreated container
  // usually gets a new one, so requests would fail with 502 until the gateway is restarted.
  docker('restart', GATEWAY_CONTAINER);
  if (!(await waitHealthy(GATEWAY_CONTAINER))) {
    throw new Error(`${GATEWAY_CONTAINER} did not become healthy after recreating ${services}.`);
  }
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
    await recreateServices(QUEUE_CONTAINER, ['queue'], settings);
    await body();
  } catch (error) {
    failure = error;
  }

  // Put the queue back exactly as it was, whatever happened above.
  const restoreEnv = Object.fromEntries(
    Object.entries(original).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  await recreateServices(QUEUE_CONTAINER, ['queue'], restoreEnv);
  for (const [name, value] of Object.entries(original)) {
    if (containerEnv(QUEUE_CONTAINER, name) !== value) {
      throw new Error(`The queue service was not restored: ${name} should be ${value}.`);
    }
  }
  if (failure !== undefined) throw failure;
}
