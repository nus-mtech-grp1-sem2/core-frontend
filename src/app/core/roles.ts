/**
 * The application role is not sourced from Cognito groups.
 *
 * Per the authentication and authorization design, Cognito is only the
 * authentication source. Application authorization comes from the MySQL customer
 * record, so a browser build must not infer privileged access from Cognito group
 * membership or any browser-supplied role attribute.
 */
export type UserRole = 'customer' | 'organiser' | 'event-helper';

/** Cognito group names, exactly as they must be spelled in the user pool. */
export const ROLE_GROUPS: Readonly<Record<UserRole, string>> = {
  customer: 'customer',
  organiser: 'organiser',
  'event-helper': 'event-helper',
};

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  customer: 'Customer',
  organiser: 'Admin',
  'event-helper': 'Event Helper',
};

/** The application role from the customer table, not from Cognito claims. */
export function roleFromGroups(_groups: readonly string[]): UserRole {
  return 'customer';
}

/** Roles a visitor may pick for themselves on the register form. */
export const SELECTABLE_ROLES: readonly UserRole[] = ['customer', 'organiser', 'event-helper'];

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  customer: 'Buy tickets and manage your own orders.',
  organiser: 'List events, manage inventory and see sales.',
  'event-helper': 'Scan tickets and admit attendees at the door.',
};

export function isUserRole(value: string): value is UserRole {
  return (SELECTABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the effective role.
 *
 * This build intentionally defaults to the customer role and ignores Cognito
 * group membership. The backend customer record remains the source of truth for
 * application authorization.
 */
export function resolveRole(
  _groups: readonly string[],
  _declaredRole: string | null,
  _trustDeclared: boolean,
): UserRole {
  return 'customer';
}
