/** Plain-object factories for API responses. Dates are relative so tests never go stale. */

const DAY_MS = 24 * 3600 * 1000;

export const inDays = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString();

export function ticket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: 501,
    order_id: 301,
    event_id: 7,
    event_title: 'E2E Summer Concert',
    venue: 'Marina Bay Arena',
    starts_at: inDays(14),
    seat_label: null,
    qr_token: 'tkt_test_0123456789abcdef',
    status: 'ISSUED',
    ...overrides,
  };
}

export function order(overrides: Record<string, unknown> = {}) {
  return {
    order_id: 301,
    event_id: 7,
    status: 'PAID',
    total_amount_cents: 2500,
    currency: 'SGD',
    paid_at: inDays(-1),
    created_at: inDays(-1),
    event_title: 'E2E Summer Concert',
    venue: 'Marina Bay Arena',
    starts_at: inDays(14),
    ticket_count: 1,
    ...overrides,
  };
}

export function managedEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 7,
    title: 'E2E Summer Concert',
    description: null,
    venue: 'Marina Bay Arena',
    starts_at: inDays(14),
    total_seats: 100,
    available_buyers: 100,
    remaining_qty: 60,
    tier: 'TIER1_GA',
    status: 'PUBLISHED',
    price_cents: 2500,
    ...overrides,
  };
}
