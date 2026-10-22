import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023110000_customer_rls_without_request_headers.sql', import.meta.url),
  'utf8',
);

describe('customer RLS uses database-owned identity rather than tenant headers', () => {
  it('scopes profile select and update to the authenticated user single-tenant profile', () => {
    expect(migration).toContain('create policy "Customers can read own profile"');
    expect(migration).toContain('create policy "Customers can update own profile"');
    expect(migration).toContain('auth_user_id = auth.uid()');
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)');
  });

  it('scopes all saved-address operations through the owned customer profile', () => {
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(migration).toContain(`create policy customer_addresses_${operation}_own`);
    }
    expect(migration).toContain('cp.id = customer_addresses.customer_id');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('cp.restaurant_id = customer_addresses.restaurant_id');
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), customer_addresses.restaurant_id)');
  });

  it('does not rely on caller-supplied request tenant headers for customer row access', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });
});
