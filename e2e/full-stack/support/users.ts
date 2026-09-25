import { existsSync } from 'node:fs';

export type Role = 'customer' | 'customer2' | 'organiser' | 'helper';

// Locally the credentials live in the gitignored e2e/.auth/users.env; in CI they arrive as
// environment variables (secrets). Environment variables already set win over the file.
const ENV_FILE = 'e2e/.auth/users.env';
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** The test accounts in the shared Cognito pool. Passwords are never logged or committed. */
export function credentials(role: Role): Credentials {
  const key = role.toUpperCase();
  const password = process.env[`E2E_${key}_PASSWORD`];
  if (!password) {
    throw new Error(
      `E2E_${key}_PASSWORD is not set. Locally, put it in ${ENV_FILE}; in CI, provide it as a secret.`,
    );
  }
  return { email: process.env[`E2E_${key}_EMAIL`] ?? `e2e-${role}@example.com`, password };
}
