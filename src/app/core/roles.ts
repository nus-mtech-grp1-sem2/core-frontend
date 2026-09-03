/**
 * The three kinds of user in OneStage.
 *
 * A role is never chosen by the browser — it comes from the `cognito:groups`
 * claim in the signed token, so the only way to gain one is for an admin to put
 * the user in that Cognito group. Anyone signed in without a group is a
 * customer, which is what self sign-up produces.
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
  organiser: 'Organiser',
  'event-helper': 'Event helper',
};

/**
 * Most privileged group wins, so a user who is both an organiser and a helper
 * gets the organiser experience rather than an arbitrary one.
 */
const PRECEDENCE: readonly UserRole[] = ['organiser', 'event-helper', 'customer'];

export function roleFromGroups(groups: readonly string[]): UserRole {
  const normalised = groups.map((group) => group.trim().toLowerCase());
  return PRECEDENCE.find((role) => normalised.includes(ROLE_GROUPS[role])) ?? 'customer';
}

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  customer: 'Buy tickets and manage your own orders.',
  organiser: 'List events, manage inventory and see sales.',
  'event-helper': 'Scan tickets and admit attendees at the door.',
};
