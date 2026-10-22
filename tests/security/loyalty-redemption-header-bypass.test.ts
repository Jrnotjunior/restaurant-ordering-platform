import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023140000_loyalty_redemption_without_headers.sql', import.meta.url),
  'utf8',
);

describe('loyalty redemption tenant authorization', () => {
  it('does not use caller-controlled tenant headers in either redemption RPC', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('binds pending payment redemption to the signed-in customer and payment restaurant', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(migration).toContain('restaurant_id = v_payment.restaurant_id');
    expect(migration).toContain('auth_user_id = auth.uid()');
    expect(migration).toContain('v_payment.customer_id <> v_customer.id');
    expect(migration).toContain('v_payment.status <> \'pending\'');
  });

  it('preserves staff authorization and requires customer ownership for customer order redemption', () => {
    expect(migration).toContain('r.owner_id = auth.uid()');
    expect(migration).toContain("s.role = 'cashier'");
    expect(migration).toContain('cp.id = p_customer_id');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('v_order.customer_id is distinct from p_customer_id');
  });
});
