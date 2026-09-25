import { startsTodayOrLater } from './event-dates';

describe('startsTodayOrLater', () => {
  const now = new Date(2026, 8, 21, 15, 30);
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).toISOString();

  it('is false for an event that started on an earlier day', () => {
    expect(startsTodayOrLater(at(20, 23, 59), now)).toBe(false);
    expect(startsTodayOrLater(at(14, 19), now)).toBe(false);
  });

  it('is true for an event today, even one that began hours ago', () => {
    expect(startsTodayOrLater(at(21, 0), now)).toBe(true);
    expect(startsTodayOrLater(at(21, 9), now)).toBe(true);
    expect(startsTodayOrLater(at(21, 19, 30), now)).toBe(true);
  });

  it('is true for any later day', () => {
    expect(startsTodayOrLater(at(22, 19), now)).toBe(true);
    expect(startsTodayOrLater(new Date(2026, 10, 30, 19).toISOString(), now)).toBe(true);
  });

  it('keeps an event whose start time is missing or unreadable rather than hiding it', () => {
    expect(startsTodayOrLater(undefined, now)).toBe(true);
    expect(startsTodayOrLater('not a date', now)).toBe(true);
  });
});
