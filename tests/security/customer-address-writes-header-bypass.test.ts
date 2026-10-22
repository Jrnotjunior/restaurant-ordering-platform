import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023170000_customer_address_writes_without_headers.sql', import.meta.url),
  'utf8',
);

describe('customer address write tenant authorization', () => {
  it('does not rely on caller-controlled tenant headers', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('binds all address writes to the signed-in customer profile and restaurant', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('ca.customer_id = v_customer_id');
    expect(migration).toContain('ca.restaurant_id = p_restaurant_id');
  });

  it('preserves the two-address limit and authenticated-only execution', () => {
    expect(migration).toContain('You can save a maximum of 2 addresses.');
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
  });
});
