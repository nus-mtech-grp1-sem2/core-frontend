import { test } from '@playwright/test';

import { saveSession, signInThroughCognito } from './support/auth';
import { assertLocalStack } from './support/stack';
import type { Role } from './support/users';

const roles: Role[] = ['customer', 'customer2', 'organiser', 'helper'];

test.beforeAll(() => assertLocalStack());

for (const role of roles) {
  test(`sign in as ${role}`, async ({ page }) => {
    saveSession(role, await signInThroughCognito(page, role));
  });
}
