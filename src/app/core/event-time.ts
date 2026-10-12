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

/**
 * The start time from the event service (UTC) as the browser-local
 * 'YYYY-MM-DDTHH:mm' a datetime-local input shows. An unparseable date gives ''.
 */
export function toDateTimeLocal(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A datetime-local value, which has no zone and is in browser-local time, as
 * the UTC ISO time the event service stores. An unparseable value is sent as
 * it is, for the service to refuse.
 */
export function fromDateTimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
