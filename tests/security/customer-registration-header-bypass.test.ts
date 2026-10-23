import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261023200000_customer_registration_without_forged_headers.sql', import.meta.url),
  'utf8',
);

describe('customer registration tenant authorization', () => {
  it('does not use caller-controlled tenant headers as authorization', () => {
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
    expect(migration).not.toContain('x-restaurant-domain');
    expect(migration).not.toContain('x-restaurant-slug');
  });

  it('requires an authenticated user and an active database restaurant', () => {
    expect(migration).toContain('if auth.uid() is null');
    expect(migration).toContain('where r.id = p_restaurant_id');
    expect(migration).toContain('and r.is_active = true');
  });

  it('uses the split-name profile schema and creates the loyalty account', () => {
    expect(migration).toContain('first_name');
    expect(migration).toContain('last_name');
    expect(migration).toContain('insert into public.customer_loyalty_accounts');
    expect(migration).toContain('on conflict (customer_id) do nothing');
  });

  it('keeps the RPC available only to authenticated users', () => {
    expect(migration).toContain('from public, anon');
    expect(migration).toContain('to authenticated');
  });
});
