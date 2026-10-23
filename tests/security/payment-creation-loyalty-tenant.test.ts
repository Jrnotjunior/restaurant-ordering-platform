import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024030000_guard_payment_creation_loyalty_tenant.sql', import.meta.url),
  'utf8',
);

describe('loyalty redemption during pending payment creation', () => {
  it('checks single-tenant identity only in the authenticated loyalty redemption path', () => {
    expect(migration).toContain('if p_redeem_loyalty then');
    expect(migration).toContain("if auth.uid() is null then");
    expect(migration).toContain('customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('derives the customer from the authenticated identity and requested payment tenant', () => {
    expect(migration).toContain('where cp.restaurant_id = p_restaurant_id');
    expect(migration).toContain('and cp.auth_user_id = auth.uid()');
    expect(migration).not.toContain('get_request_restaurant_id');
    expect(migration).not.toContain('request.headers');
    expect(migration).not.toContain('x-restaurant-domain');
    expect(migration).not.toContain('x-restaurant-slug');
  });

  it('preserves guest checkout while keeping the loyalty flag optional', () => {
    expect(migration).toContain('p_redeem_loyalty boolean default false');
    expect(migration).toContain('grant execute on function public.create_pending_online_payment(');
    expect(migration).toContain(') to anon, authenticated;');
  });

  it('preserves server-side product pricing and pending payment creation', () => {
    expect(migration).toContain('and p.restaurant_id = p_restaurant_id');
    expect(migration).toContain('and p.is_available = true');
    expect(migration).toContain('insert into public.pending_online_payments');
    expect(migration).toContain('greatest(round(v_subtotal + v_delivery_fee - v_discount, 2), 0)');
  });
});
