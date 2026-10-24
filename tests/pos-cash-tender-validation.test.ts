import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261024101000_reject_nonfinite_pos_cash_tender.sql', import.meta.url),
  'utf8',
);
const functionBody = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.confirm_pos_cash_payment_with_tender'),
);

describe('POS cash tender database validation', () => {
  it('rejects NaN and both infinities before updating a payment', () => {
    expect(functionBody).toContain("p_cash_received_amount::text IN ('NaN', 'Infinity', '-Infinity')");
    expect(functionBody).toContain('Cash received must be a finite, non-negative amount.');
    expect(functionBody.indexOf("p_cash_received_amount::text IN ('NaN', 'Infinity', '-Infinity')"))
      .toBeLessThan(functionBody.indexOf('UPDATE public.orders'));
  });

  it('requires authorized cashier/owner access and locks the pending order row', () => {
    expect(functionBody).toContain('r.owner_id = auth.uid()');
    expect(functionBody).toContain("s.role = 'cashier'");
    expect(functionBody).toContain('s.is_active = true');
    expect(functionBody).toContain('FOR UPDATE OF o');
    expect(functionBody).toContain("v_order.payment_status <> 'pending'");
    expect(functionBody).toContain("v_order.status <> 'pending'");
  });

  it('rejects underpayment and derives change from the persisted order total', () => {
    expect(functionBody).toContain('round(p_cash_received_amount, 2) < round(v_order.total, 2)');
    expect(functionBody).toContain('round(round(p_cash_received_amount, 2) - round(v_order.total, 2), 2)');
    expect(functionBody).toContain('cash_received_amount = round(p_cash_received_amount, 2)');
    expect(functionBody).toContain('cash_change_amount = v_change');
  });

  it('does not expose the privileged payment RPC to public/anonymous callers', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) FROM public, anon;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) TO authenticated;');
  });

  it('is a function-only migration and does not backfill or rewrite historical orders', () => {
    expect(migration).toContain('This changes only the function definition');
    expect(migration).not.toMatch(/UPDATE\s+public\.orders\s+SET\s+(?:cash_received_amount|cash_change_amount)\s*=/i);
  });
});
