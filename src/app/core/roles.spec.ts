import { roleFromGroups } from './roles';

describe('roleFromGroups', () => {
  it('treats a user with no groups as a customer', () => {
    expect(roleFromGroups([])).toBe('customer');
  });

  it('reads each role from its Cognito group', () => {
    expect(roleFromGroups(['organiser'])).toBe('organiser');
    expect(roleFromGroups(['event-helper'])).toBe('event-helper');
    expect(roleFromGroups(['customer'])).toBe('customer');
  });

  it('gives the most privileged role when a user is in several groups', () => {
    expect(roleFromGroups(['customer', 'event-helper', 'organiser'])).toBe('organiser');
    expect(roleFromGroups(['customer', 'event-helper'])).toBe('event-helper');
  });

  it('ignores casing and stray whitespace from the pool', () => {
    expect(roleFromGroups([' Organiser '])).toBe('organiser');
  });

  it('ignores groups it does not know', () => {
    expect(roleFromGroups(['admin', 'finance'])).toBe('customer');
  });
});
