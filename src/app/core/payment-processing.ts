const PAYMENT_PROCESSING_MARKER_MAX_AGE_MS = 5 * 60_000;
const paymentProcessingKey = (orderId: number) => `onestage.acceptedPayment.${orderId}`;
const legacyPaymentProcessingKey = (orderId: number) => `onestage.mockPayment.${orderId}`;

export function setPaymentProcessing(orderId: number, processing: boolean): void {
  try {
    const key = paymentProcessingKey(orderId);
    sessionStorage.removeItem(legacyPaymentProcessingKey(orderId));
    if (processing) sessionStorage.setItem(key, String(Date.now()));
    else sessionStorage.removeItem(key);
  } catch {
    // Browser storage is optional; backend order state remains authoritative.
  }
}

export function hasSubmittedPayment(orderId: number, orderCreatedAt?: string): boolean {
  try {
    const key = paymentProcessingKey(orderId);
    sessionStorage.removeItem(legacyPaymentProcessingKey(orderId));
    const startedAt = Number(sessionStorage.getItem(key));
    const age = Date.now() - startedAt;
    const createdAt = Date.parse(orderCreatedAt ?? '');
    const belongsToOrder = !Number.isFinite(createdAt) || startedAt >= createdAt - 1_000;
    if (
      Number.isFinite(startedAt) &&
      startedAt > 0 &&
      age >= 0 &&
      age <= PAYMENT_PROCESSING_MARKER_MAX_AGE_MS &&
      belongsToOrder
    ) {
      return true;
    }
    sessionStorage.removeItem(key);
    return false;
  } catch {
    return false;
  }
}

export function clearPaymentProcessing(orderId: number): void {
  setPaymentProcessing(orderId, false);
}
