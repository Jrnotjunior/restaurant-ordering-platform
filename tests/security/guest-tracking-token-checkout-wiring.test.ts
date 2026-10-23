import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('guest tracking token checkout wiring', () => {
  it('uses dedicated tracking wrappers for both cash checkout branches', () => {
    const source = read('../../src/modules/ordering/orderRepository.ts');
    expect(source).toContain("'create_order_with_guest_tracking_token'");
    expect(source).toContain("'create_order_from_delivery_quote_with_guest_tracking_token'");
    expect(source.match(/p_guest_tracking_token_hash: guestTrackingToken\.tokenHash/g)).toHaveLength(2);
  });
  it('stores the raw token in browser storage rather than sending it in RPC params', () => {
    const source = read('../../src/modules/ordering/orderRepository.ts');
    expect(source).toContain('saveGuestOrderTrackingToken(row.order_id, guestTrackingToken.token)');
    expect(source).not.toContain('p_guest_tracking_token: guestTrackingToken.token');
  });
  it('supports a separate browser storage key and validates token format on retrieval', () => {
    const source = read('../../src/modules/ordering/guestOrderTrackingToken.ts');
    expect(source).toContain('restaurant-ordering-guest-tracking-token:');
    expect(source).toContain('isGuestOrderTrackingTokenFormat(token)');
  });
});
