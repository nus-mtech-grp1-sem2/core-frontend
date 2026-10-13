/**
 * Events carry a start time but no end time, so an event counts as completed
 * as soon as it has started. An unparseable date is never completed.
 */
export function isCompleted(startsAt: string | Date, now: number = Date.now()): boolean {
  return new Date(startsAt).getTime() < now;
}

// Events are always Singapore-local: an organiser picks a Singapore wall-clock
// start time, so every viewer must see that same wall-clock time regardless of
// their own browser/system timezone.
const EVENT_TIME_ZONE = 'Asia/Singapore';

export function formatEventDate(startsAt: string | Date): string {
  return new Date(startsAt).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  });
}

export function formatEventTime(startsAt: string | Date): string {
  return new Date(startsAt).toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: EVENT_TIME_ZONE,
  });
}

/**
 * The value a `<input type="datetime-local">` needs to show an instant's
 * Singapore wall-clock time ("YYYY-MM-DDTHH:mm"). Used to pre-fill the edit
 * form: naively slicing the ISO string would show the instant's UTC digits
 * instead of its Singapore wall-clock time, off by Singapore's +8 offset.
 */
export function toSingaporeInputValue(startsAt: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(startsAt));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
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
