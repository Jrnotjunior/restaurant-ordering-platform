/**
 * Dedicated guest order-tracking capability primitives.
 *
 * This token is intentionally separate from the guest cancellation token:
 * possession must authorize reading tracking status only, never cancellation.
 * Callers must send only tokenHash to database writes and retain token only in
 * the customer's browser/recovery fragment. Do not log the raw token.
 */
const GUEST_ORDER_TRACKING_TOKEN_BYTES = 32;
const GUEST_ORDER_TRACKING_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashGuestOrderTrackingToken(token: string): Promise<string> {
  if (!GUEST_ORDER_TRACKING_TOKEN_PATTERN.test(token)) {
    throw new Error('Invalid guest order-tracking token format.');
  }

  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.subtle) {
    throw new Error('Your browser cannot securely validate an order-tracking token. Please update your browser.');
  }

  const digest = await secureCrypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export async function createGuestOrderTrackingToken(): Promise<{ token: string; tokenHash: string }> {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.getRandomValues || !secureCrypto.subtle) {
    throw new Error('Your browser cannot create a secure order-tracking token. Please update your browser before placing an order.');
  }

  const randomBytes = new Uint8Array(GUEST_ORDER_TRACKING_TOKEN_BYTES);
  secureCrypto.getRandomValues(randomBytes);
  const token = bytesToHex(randomBytes);
  const tokenHash = await hashGuestOrderTrackingToken(token);
  return { token, tokenHash };
}

/** True only for the full 256-bit hex capability format used by this module. */
export function isGuestOrderTrackingTokenFormat(token: string): boolean {
  return GUEST_ORDER_TRACKING_TOKEN_PATTERN.test(token);
}


const GUEST_TRACKING_TOKEN_STORAGE_PREFIX = 'restaurant-ordering-guest-tracking-token:';

/** Keep the raw tracking capability in this browser only; never send it to database writes. */
export function saveGuestOrderTrackingToken(orderId: string, token: string): boolean {
  if (typeof window === 'undefined' || !isGuestOrderTrackingTokenFormat(token)) return false;
  const key = `${GUEST_TRACKING_TOKEN_STORAGE_PREFIX}${orderId}`;
  try {
    window.localStorage.setItem(key, token);
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, token);
      return true;
    } catch {
      return false;
    }
  }
}

export function readGuestOrderTrackingToken(orderId: string): string | null {
  if (typeof window === 'undefined') return null;
  const key = `${GUEST_TRACKING_TOKEN_STORAGE_PREFIX}${orderId}`;
  try {
    const token = window.localStorage.getItem(key);
    if (token && isGuestOrderTrackingTokenFormat(token)) return token;
  } catch {
    // Try tab-scoped storage if persistent storage is unavailable.
  }
  try {
    const token = window.sessionStorage.getItem(key);
    return token && isGuestOrderTrackingTokenFormat(token) ? token : null;
  } catch {
    return null;
  }
}

export function clearGuestOrderTrackingToken(orderId: string): void {
  if (typeof window === 'undefined') return;
  const key = `${GUEST_TRACKING_TOKEN_STORAGE_PREFIX}${orderId}`;
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
  try { window.sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Move a temporary online-payment capability onto its finalized order ID. */
export function linkGuestOrderTrackingTokenToOrder(paymentReferenceNumber: string, orderId: string): void {
  const token = readGuestOrderTrackingToken(`payment:${paymentReferenceNumber}`);
  if (!token) return;
  saveGuestOrderTrackingToken(orderId, token);
  clearGuestOrderTrackingToken(`payment:${paymentReferenceNumber}`);
}
