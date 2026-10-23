import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(
  new URL(`../../supabase/migrations/${name}`, import.meta.url),
  'utf8',
);

describe('guest order-tracking privacy safeguards', () => {
  it('keeps authenticated order tracking restricted to the matching customer profile', () => {
    const sql = migration('20261012100000_restrict_customer_order_tracking_to_owner.sql');

    expect(sql).toContain('auth.uid() is null');
    expect(sql).toContain('cp.id = o.customer_id');
    expect(sql).toContain('cp.restaurant_id = o.restaurant_id');
    expect(sql).toContain('cp.auth_user_id = auth.uid()');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_order_status_by_id(uuid) FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO anon, authenticated');
  });

  it('redacts rider phone and delivery-failure details from anonymous tracking responses', () => {
    const sql = migration('20261012213000_redact_private_fields_from_guest_order_tracking.sql');

    expect(sql).toContain('CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.mobile_number END');
    expect(sql).toContain('CASE WHEN auth.uid() IS NULL THEN NULL ELSE o.delivery_failure_reason END');
    expect(sql).toContain('Could not safely redact private fields from guest order tracking');
  });

  it('redacts rider identity from anonymous tracking responses', () => {
    const sql = migration('20261012223000_redact_rider_name_from_guest_order_tracking.sql');

    expect(sql).toContain('CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.name END');
    expect(sql).toContain('Expected rider-name projection not found; no change made');
  });

  it('documents the remaining UUID-as-bearer-credential risk instead of claiming it is solved', () => {
    const sql = migration('20261010141000_secure_customer_order_tracking.sql');

    expect(sql).toContain('Replace guessable order-number tracking with an opaque order UUID');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO anon, authenticated');
  });
});
