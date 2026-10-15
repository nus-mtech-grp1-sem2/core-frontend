import { pendingPaymentLink } from './pending-payment-link';
import { setPaymentProcessing } from './payment-processing';

describe('pendingPaymentLink', () => {
  const now = Date.now();
  const order = {
    order_id: 42,
    event_id: 7,
    status: 'PENDING',
    reservation_expires_at: new Date(now + 180_000).toISOString(),
  };

  afterEach(() => sessionStorage.clear());

  it('returns the existing payment page for the same event only', () => {
    expect(pendingPaymentLink(7, [order], now)).toEqual(['/checkout', 42]);
    expect(pendingPaymentLink(8, [order], now)).toBeNull();
  });

  it.each(['PAID', 'CANCELLED', 'FAILED'])('ignores %s orders', (status) => {
    expect(pendingPaymentLink(7, [{ ...order, status }], now)).toBeNull();
  });

  it('ignores expired reservations but keeps submitted payments on the payment page', () => {
    const expired = { ...order, reservation_expires_at: new Date(now - 1).toISOString() };
    expect(pendingPaymentLink(7, [expired], now)).toBeNull();
    setPaymentProcessing(order.order_id, true);
    expect(pendingPaymentLink(7, [expired], now)).toEqual(['/checkout', 42]);
  });
});
