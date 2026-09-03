/**
 * The three areas of OneStage: buying tickets, running events, and working
 * the door.
 *
 * Every signed-in account has all three — there is no access control by
 * role. `UserRole` and its labels exist only for places that still need to
 * name one of the three areas, such as the workspace switcher in the header
 * and the per-event team roster.
 */
export type UserRole = 'customer' | 'organiser' | 'event-helper';

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
  return PRECEDENCE.find((role) => normalised.includes(role)) ?? 'customer';
}

export const ROLE_DESCRIPTIONS: Readonly<Record<UserRole, string>> = {
  customer: 'Buy tickets and manage your own orders.',
  organiser: 'List events, manage inventory and see sales.',
  'event-helper': 'Scan tickets and admit attendees at the door.',
};
