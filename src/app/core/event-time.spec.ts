import { fromDateTimeLocal, isCompleted, toDateTimeLocal } from './event-time';

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

// The expected values are built with local-time Date constructors, so these
// hold in whatever zone the tests run.
describe('toDateTimeLocal', () => {
  it('shows a UTC start time as the local time a datetime-local input takes', () => {
    const startsAt = '2026-10-12T15:13:00.000Z';
    const local = toDateTimeLocal(startsAt);

    expect(local).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    expect(new Date(local).toISOString()).toBe(startsAt);
  });

  it('pads single-digit months, days, hours and minutes', () => {
    expect(toDateTimeLocal(new Date(2026, 0, 5, 7, 3).toISOString())).toBe('2026-01-05T07:03');
  });

  it('is empty when the date cannot be parsed', () => {
    expect(toDateTimeLocal('')).toBe('');
    expect(toDateTimeLocal('not a date')).toBe('');
  });
});

describe('fromDateTimeLocal', () => {
  it('sends the local time picked in a datetime-local input as UTC', () => {
    expect(fromDateTimeLocal('2026-10-12T23:13')).toBe(new Date(2026, 9, 12, 23, 13).toISOString());
  });

  it('round-trips with toDateTimeLocal, so saving an untouched form keeps the time', () => {
    const startsAt = '2026-10-12T15:13:00.000Z';
    expect(fromDateTimeLocal(toDateTimeLocal(startsAt))).toBe(startsAt);
  });

  it('passes an unparseable value through for the event service to refuse', () => {
    expect(fromDateTimeLocal('')).toBe('');
    expect(fromDateTimeLocal('someday')).toBe('someday');
  });
});
