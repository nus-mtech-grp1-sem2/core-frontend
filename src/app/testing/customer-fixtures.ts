const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO start time this many days from now; negative for an event already in the past. */
export function startsInDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

/** A customer's issued ticket, as returned by `/customers/me/tickets`. */
export function ticketFixture(id: number, title: string, days: number) {
  return {
    ticket_id: id,
    order_id: 100 + id,
    event_id: id,
    event_title: title,
    venue: 'Test Hall',
    starts_at: startsInDays(days),
    seat_label: null,
    qr_token: `token-${id}`,
    status: 'ISSUED',
  };
}

/** A paid order still waiting for its ticket, as returned by `/customers/me/orders`. */
export function paidOrderFixture(id: number, title: string, days: number) {
  return {
    order_id: 200 + id,
    event_id: id,
    status: 'PAID',
    total_amount_cents: 2_000,
    currency: 'SGD',
    paid_at: null,
    event_title: title,
    venue: 'Test Hall',
    starts_at: startsInDays(days),
    ticket_count: 1,
  };
}
