import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024000000_guard_customer_profile_id_tenant.sql', import.meta.url),
  'utf8',
);

describe('customer profile ID tenant authorization', () => {
  it('requires authentication and validates existing customer identities against the requested tenant', () => {
    expect(migration).toContain('if auth.uid() is null');
    expect(migration).toContain('customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('preserves first-time registration when the authenticated user has no customer profile yet', () => {
    expect(migration).toContain('if not exists (');
    expect(migration).toContain('where cp.auth_user_id = auth.uid()');
    expect(migration).toContain('return null;');
  });

  it('does not use caller-controlled restaurant headers as its authorization check', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
    expect(migration).not.toContain('x-restaurant-domain');
    expect(migration).not.toContain('x-restaurant-slug');
  });

  it('restricts execution to authenticated callers', () => {
    expect(migration).toContain('revoke all on function public.get_my_customer_profile_id(uuid) from public, anon;');
    expect(migration).toContain('grant execute on function public.get_my_customer_profile_id(uuid) to authenticated;');
  });
});
