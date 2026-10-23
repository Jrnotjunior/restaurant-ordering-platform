import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024010000_guard_pending_payment_customer_attachment.sql', import.meta.url),
  'utf8',
);

describe('pending payment customer attachment tenant authorization', () => {
  it('checks the payment tenant against the signed-in customer identity', () => {
    expect(migration).toContain('customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(migration).toContain("raise exception 'Customer account does not belong to this restaurant'");
  });

  it('requires the requested profile to belong to both the authenticated user and payment restaurant', () => {
    expect(migration).toContain('where id = p_customer_id');
    expect(migration).toContain('and restaurant_id = v_payment.restaurant_id');
    expect(migration).toContain('and auth_user_id = auth.uid()');
  });

  it('does not overwrite a different customer already attached to the payment', () => {
    expect(migration).toContain('if v_payment.customer_id is not null and v_payment.customer_id <> p_customer_id then');
    expect(migration).toContain("raise exception 'A different customer is already attached to this payment'");
  });

  it('restricts execution to authenticated callers', () => {
    expect(migration).toContain('revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public, anon;');
    expect(migration).toContain('grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;');
  });
});
