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
