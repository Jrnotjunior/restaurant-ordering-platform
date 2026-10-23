import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023190000_customer_profile_read_without_headers.sql', import.meta.url),
  'utf8',
);

describe('customer profile read tenant authorization', () => {
  it('does not rely on caller-controlled tenant headers', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('only returns the authenticated user profile and its tenant-owned default address', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('ca.restaurant_id = p_restaurant_id');
    expect(migration).toContain('ca.is_default = true');
  });

  it('restricts execution to authenticated users', () => {
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
  });
});
