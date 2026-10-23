import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023130000_customer_profile_id_without_headers.sql', import.meta.url),
  'utf8',
);

describe('customer profile ID lookup does not trust tenant headers', () => {
  it('requires a single-tenant identity and queries only the authenticated user profile', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });

  it('keeps the RPC unavailable to anonymous callers', () => {
    expect(migration).toContain('revoke all on function public.get_my_customer_profile_id(uuid) from public, anon');
    expect(migration).toContain('grant execute on function public.get_my_customer_profile_id(uuid) to authenticated');
  });
});
