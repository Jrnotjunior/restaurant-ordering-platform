import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023210000_guard_customer_loyalty_order_history.sql', import.meta.url),
  'utf8',
);

describe('customer loyalty and order-history tenant authorization', () => {
  it('requires an authenticated identity for both RPCs', () => {
    expect(migration.match(/if auth\.uid\(\) is null/g)).toHaveLength(2);
  });

  it('requires the identity to have exactly one customer tenant before returning data', () => {
    expect(migration.match(/customer_identity_is_single_tenant\(auth\.uid\(\), p_restaurant_id\)/g)).toHaveLength(2);
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('does not use caller-controlled request tenant headers as authorization', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
    expect(migration).not.toContain('x-restaurant-domain');
    expect(migration).not.toContain('x-restaurant-slug');
  });

  it('restricts both RPCs to authenticated callers', () => {
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
  });
});
