import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024020000_guard_customer_order_attachment.sql', import.meta.url),
  'utf8',
);

describe('customer order attachment tenant authorization', () => {
  it('checks self-attachment against the order restaurant and the single-tenant identity helper', () => {
    expect(migration).toContain('v_customer.auth_user_id = auth.uid()');
    expect(migration).toContain('customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id)');
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('retains the existing owner and active cashier authorization path', () => {
    expect(migration).toContain('r.owner_id = auth.uid()');
    expect(migration).toContain("s.role = 'cashier'");
    expect(migration).toContain('s.is_active = true');
  });

  it('does not overwrite a different customer already attached to the order', () => {
    expect(migration).toContain('if v_order.customer_id is not null and v_order.customer_id <> p_customer_id then');
    expect(migration).toContain("raise exception 'A different customer is already attached to this order'");
  });

  it('restricts execution to authenticated callers', () => {
    expect(migration).toContain('revoke all on function public.attach_customer_to_order(uuid, uuid) from public, anon;');
    expect(migration).toContain('grant execute on function public.attach_customer_to_order(uuid, uuid) to authenticated;');
  });
});
