import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023150000_customer_order_history_without_headers.sql', import.meta.url),
  'utf8',
);

describe('customer order history tenant authorization', () => {
  it('does not use caller-controlled tenant headers', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('limits results to the signed-in customer profile and requested restaurant', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('o.restaurant_id = p_restaurant_id');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('p_restaurant_id is not null');
  });
});
