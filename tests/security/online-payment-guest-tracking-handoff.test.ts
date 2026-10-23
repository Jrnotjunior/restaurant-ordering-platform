import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('online payment guest tracking handoff', () => {
  it('creates and stores a dedicated tracking token against the payment reference', () => {
    const payments = read('../../src/modules/payments/paymentRepository.ts');
    expect(payments).toContain('createGuestOrderTrackingToken()');
    expect(payments).toContain('p_guest_tracking_token_hash: guestTrackingToken.tokenHash');
    expect(payments).toContain('saveGuestOrderTrackingToken(`payment:${row.reference_number}`, guestTrackingToken.token)');
    expect(payments).not.toContain('p_guest_tracking_token: guestTrackingToken.token');
  });

  it('moves the browser token to the finalized order only after the payment is paid', () => {
    const payments = read('../../src/modules/payments/paymentRepository.ts');
    const paidBranch = payments.indexOf("if (row.status === 'paid' && orderId)");
    const trackingLink = payments.indexOf('linkGuestOrderTrackingTokenToOrder(referenceNumber, orderId)');
    expect(paidBranch).toBeGreaterThanOrEqual(0);
    expect(trackingLink).toBeGreaterThan(paidBranch);
    expect(payments).toContain('linkGuestOrderTrackingTokenToOrder');
  });

  it('checks payment status on the return path before routing to order tracking', () => {
    const checkout = read('../../src/pages/CheckoutPage.tsx');
    expect(checkout).toContain("params.get('payment')");
    expect(checkout).toContain("params.get('reference')");
    expect(checkout).toContain('getOnlinePaymentStatus(paymentReference)');
    expect(checkout).toContain('result.status === \'paid\' && result.orderNumber && result.orderId');
    expect(checkout).toContain('setConfirmedOrder({');
    expect(checkout).toContain('buildOrderTrackingUrl(window.location.pathname, confirmedOrder.orderId)');
  });

  it('keeps tracking-token recovery in the URL fragment and strips secrets from the visible URL', () => {
    const tracking = read('../../src/pages/OrderTrackingPage.tsx');
    expect(tracking).toContain("values.get('guest-tracking-token')");
    expect(tracking).toContain('saveGuestOrderTrackingToken(orderId, trackingToken.toLowerCase())');
    expect(tracking).toContain('window.history.replaceState(');
    expect(tracking).toContain('window.location.pathname + window.location.search');
  });
});
