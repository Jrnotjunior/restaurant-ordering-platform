import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023120000_update_customer_address_without_headers.sql', import.meta.url),
  'utf8',
);

describe('saved-address update RPC does not trust tenant headers', () => {
  it('authorizes the requested tenant from the authenticated customer profile', () => {
    expect(migration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain('cp.auth_user_id = auth.uid()');
    expect(migration).toContain('cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('ca.customer_id = v_customer_id');
    expect(migration).toContain('ca.restaurant_id = p_restaurant_id');
  });

  it('does not use request headers as authorization proof', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
  });
});
