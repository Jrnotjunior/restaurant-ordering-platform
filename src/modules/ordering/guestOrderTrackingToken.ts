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
