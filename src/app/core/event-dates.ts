/**
 * True for an event that starts today (even if it began hours ago, the day is not over)
 * or later. An event with no readable start time is kept: hiding a ticket the customer
 * paid for because of bad data is worse than listing one too many.
 */
export function startsTodayOrLater(startsAt: string | undefined, now: Date): boolean {
  const start = new Date(startsAt ?? '').getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Number.isNaN(start) || start >= startOfToday;
}
