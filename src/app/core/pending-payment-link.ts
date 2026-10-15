import { hasSubmittedPayment } from './payment-processing';

interface CustomerOrder {
  readonly order_id: number;
  readonly event_id: number;
  readonly status: string;
  readonly created_at?: string;
  readonly reservation_expires_at?: string;
}

/** Reuse a live reservation rather than joining the event's queue again. */
export function pendingPaymentLink(
  eventId: number,
  orders: readonly CustomerOrder[],
  now: number,
): readonly (string | number)[] | null {
  const order = orders.find((candidate) => {
    if (candidate.event_id !== eventId || candidate.status !== 'PENDING') return false;
    const expiresAt = Date.parse(candidate.reservation_expires_at ?? '');
    return (
      !Number.isFinite(expiresAt) ||
      expiresAt > now ||
      hasSubmittedPayment(candidate.order_id, candidate.created_at)
    );
  });
  return order ? ['/checkout', order.order_id] : null;
}
