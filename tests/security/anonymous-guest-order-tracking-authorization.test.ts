import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024100000_revoke_anonymous_uuid_order_tracking.sql', import.meta.url),
  'utf8',
);
const repository = readFileSync(
  new URL('../../src/modules/ordering/orderRepository.ts', import.meta.url),
  'utf8',
);

describe('anonymous guest order tracking authorization', () => {
  it('revokes UUID-only tracking from anonymous callers while preserving authenticated access', () => {
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) FROM anon');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO authenticated');
  });

  it('uses the token-authorized RPC for guests and UUID RPC only after checking authentication', () => {
    expect(repository).toContain("'get_guest_order_status_by_tracking_token'");
    expect(repository).toContain("'get_order_status_by_id'");
    expect(repository).toContain("if (authError || !authData.user)");
    expect(repository).toContain('p_guest_tracking_token_hash: guestTrackingTokenHash');
  });
});
