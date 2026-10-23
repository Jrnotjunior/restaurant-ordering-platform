import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023230000_guard_loyalty_redemption_tenant.sql', import.meta.url),
  'utf8',
);

describe('customer loyalty redemption tenant authorization', () => {
  it('requires an authenticated user and checks the payment tenant against the customer identity', () => {
    expect(migration).toContain('if auth.uid() is null');
    expect(migration).toContain('customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('uses the payment row as tenant context instead of request headers', () => {
    expect(migration).toContain('where id = p_payment_id');
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
    expect(migration).not.toContain('x-restaurant-domain');
    expect(migration).not.toContain('x-restaurant-slug');
  });

  it('restricts the RPC to authenticated callers', () => {
    expect(migration).toContain('revoke all on function public.redeem_loyalty_reward_for_pending_payment(uuid) from public, anon;');
    expect(migration).toContain('grant execute on function public.redeem_loyalty_reward_for_pending_payment(uuid) to authenticated;');
  });
});
