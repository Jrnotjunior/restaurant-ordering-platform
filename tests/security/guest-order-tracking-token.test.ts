import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGuestOrderTrackingToken,
  hashGuestOrderTrackingToken,
  isGuestOrderTrackingTokenFormat,
} from '../../src/modules/ordering/guestOrderTrackingToken';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guest order-tracking token primitives', () => {
  it('creates an independent 256-bit token and stores a SHA-256 hash candidate', async () => {
    vi.stubGlobal('crypto', webcrypto as unknown as Crypto);

    const first = await createGuestOrderTrackingToken();
    const second = await createGuestOrderTrackingToken();

    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.token).not.toBe(first.tokenHash);
    expect(second.token).not.toBe(first.token);
    expect(await hashGuestOrderTrackingToken(first.token)).toBe(first.tokenHash);
  });

  it('rejects missing, short, or non-hex tokens before hashing', async () => {
    vi.stubGlobal('crypto', webcrypto as unknown as Crypto);

    await expect(hashGuestOrderTrackingToken('')).rejects.toThrow('Invalid guest order-tracking token format');
    await expect(hashGuestOrderTrackingToken('ab'.repeat(31))).rejects.toThrow('Invalid guest order-tracking token format');
    await expect(hashGuestOrderTrackingToken('g1'.repeat(32))).rejects.toThrow('Invalid guest order-tracking token format');
    expect(isGuestOrderTrackingTokenFormat('ab'.repeat(32))).toBe(true);
    expect(isGuestOrderTrackingTokenFormat('AB'.repeat(32))).toBe(false);
    expect(isGuestOrderTrackingTokenFormat('ab'.repeat(31))).toBe(false);
  });

  it('does not fall back to weak randomness when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(createGuestOrderTrackingToken()).rejects.toThrow('cannot create a secure order-tracking token');
  });
});
