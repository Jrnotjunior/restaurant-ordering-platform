/**
 * Browser-side recovery for the dedicated guest order-tracking capability.
 *
 * The raw token is a bearer credential for read-only tracking. Never log it,
 * put it in query parameters, or reuse it for order cancellation.
 */
const GUEST_TRACKING_TOKEN_STORAGE_PREFIX = 'restaurant-ordering-guest-tracking-token:';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function storageKey(orderOrPaymentKey: string): string {
  return `${GUEST_TRACKING_TOKEN_STORAGE_PREFIX}${orderOrPaymentKey}`;
}

export function saveGuestOrderTrackingToken(orderOrPaymentKey: string, token: string): boolean {
  if (typeof window === 'undefined' || !TOKEN_PATTERN.test(token)) return false;
  try {
    window.localStorage.setItem(storageKey(orderOrPaymentKey), token);
    return true;
  } catch {
    // Do not duplicate credentials into sessionStorage without an explicit caller
    // decision; callers can instead keep the token in memory for this tab.
    return false;
  }
}

export function readGuestOrderTrackingToken(orderOrPaymentKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.localStorage.getItem(storageKey(orderOrPaymentKey));
    return token && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function clearGuestOrderTrackingToken(orderOrPaymentKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(orderOrPaymentKey));
  } catch {
    // Storage may be unavailable; do not interrupt order tracking.
  }
}

/** Move the token from the payment-reference key to the finalized order key. */
export function linkGuestOrderTrackingTokenToOrder(paymentReference: string, orderId: string): boolean {
  const token = readGuestOrderTrackingToken(`payment:${paymentReference}`);
  if (!token) return false;
  if (!saveGuestOrderTrackingToken(orderId, token)) return false;
  clearGuestOrderTrackingToken(`payment:${paymentReference}`);
  return true;
}

/**
 * Recover a token from a URL fragment. The caller must immediately remove the
 * fragment from browser history after successful recovery. Fragments are not
 * sent in HTTP requests, unlike query parameters.
 */
export function readGuestOrderTrackingTokenFromFragment(hash: string): string | null {
  const match = hash.match(/^#guest-order-tracking-token=([0-9a-f]{64})$/);
  return match?.[1] ?? null;
}

/** Remove a fragment-bearing capability URL from the visible/history URL. */
export function stripUrlFragment(pathname: string, search: string): string {
  return `${pathname}${search}`;
}
