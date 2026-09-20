/**
 * Events carry a start time but no end time, so an event counts as completed
 * as soon as it has started. An unparseable date is never completed.
 */
export function isCompleted(startsAt: string | Date, now: number = Date.now()): boolean {
  return new Date(startsAt).getTime() < now;
}

export function formatEventDate(startsAt: string | Date): string {
  return new Date(startsAt).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatEventTime(startsAt: string | Date): string {
  return new Date(startsAt).toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
