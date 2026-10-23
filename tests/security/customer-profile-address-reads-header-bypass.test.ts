import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023160000_customer_profile_address_reads_without_headers.sql', import.meta.url),
  'utf8',
);

describe('customer profile/address read tenant authorization', () => {
  it('does not use caller-controlled tenant headers', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('requires the signed-in user to own the single-tenant profile', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('ca.restaurant_id = p_restaurant_id');
  });

  it('keeps execution restricted to authenticated users', () => {
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
  });
});
