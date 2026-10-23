import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024080000_authorize_auxiliary_guest_tracking_reads.sql', import.meta.url),
  'utf8',
);
const repository = readFileSync(
  new URL('../../src/modules/ordering/orderRepository.ts', import.meta.url),
  'utf8',
);

describe('auxiliary guest tracking read authorization', () => {
  it('requires customer ownership or a valid guest tracking-token hash for creation timestamps', () => {
    expect(migration).toContain('get_customer_order_created_at(\n  p_order_id uuid,\n  p_guest_tracking_token_hash text');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain("p_guest_tracking_token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('o.guest_tracking_token_hash = p_guest_tracking_token_hash');
  });

  it('applies the same authorization to cancellation/refund metadata', () => {
    expect(migration).toContain('get_order_cancellation_refund_status(\n  p_order_id uuid,\n  p_guest_tracking_token_hash text');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.get_customer_order_created_at(uuid) FROM anon');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.get_order_cancellation_refund_status(uuid) FROM anon');
  });

  it('passes only the hash, never the raw tracking token, to auxiliary RPCs', () => {
    expect(repository).toContain('const guestTrackingTokenHash = guestTrackingToken');
    expect(repository).toContain("'get_customer_order_created_at'");
    expect(repository).toContain("'get_order_cancellation_refund_status'");
    expect(repository).toContain('p_guest_tracking_token_hash: guestTrackingTokenHash');
  });
});
