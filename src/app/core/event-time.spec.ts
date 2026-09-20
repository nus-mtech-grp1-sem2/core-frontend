import { isCompleted } from './event-time';

describe('isCompleted', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');

  it('is true once the start time has passed', () => {
    expect(isCompleted('2026-09-20T11:59:59Z', now)).toBe(true);
    expect(isCompleted(new Date('2026-01-01T00:00:00Z'), now)).toBe(true);
  });

  it('is false for events that have not started yet', () => {
    expect(isCompleted('2026-09-20T12:00:01Z', now)).toBe(false);
    expect(isCompleted('2099-01-01T00:00:00Z', now)).toBe(false);
  });

  it('is false when the date cannot be parsed', () => {
    expect(isCompleted('', now)).toBe(false);
    expect(isCompleted('not a date', now)).toBe(false);
  });
});
