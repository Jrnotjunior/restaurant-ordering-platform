import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024040000_serialize_pos_cash_confirmation.sql', import.meta.url),
  'utf8',
);

describe('POS cash confirmation hardening', () => {
  it('requires an authenticated caller and pins the security-definer search path', () => {
    expect(migration).toContain("IF auth.uid() IS NULL THEN");
    expect(migration).toContain('SET search_path = public, pg_temp');
  });

  it('locks the target order before checking the pending payment state', () => {
    expect(migration).toContain('FOR UPDATE OF o');
    expect(migration).toContain("v_order.payment_status IS DISTINCT FROM 'pending'");
    expect(migration).toContain("v_order.status IS DISTINCT FROM 'pending'");
  });

  it('preserves active restaurant owner and cashier authorization', () => {
    expect(migration).toContain('v_owner_id IS DISTINCT FROM auth.uid()');
    expect(migration).toContain("s.role = 'cashier'");
    expect(migration).toContain('s.is_active = true');
    expect(migration).toContain('r.is_active = true');
  });

  it('only confirms cash orders and grants execution to authenticated callers', () => {
    expect(migration).toContain("v_order.payment_method IS DISTINCT FROM 'cash'");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.confirm_dine_in_payment(uuid) FROM PUBLIC, anon;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.confirm_dine_in_payment(uuid) TO authenticated;');
  });
});
