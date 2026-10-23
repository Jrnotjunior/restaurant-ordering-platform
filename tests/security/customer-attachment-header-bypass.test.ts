import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const attachmentMigration = readFileSync(
  new URL('../../supabase/migrations/20261023100000_authorize_customer_attachments_without_headers.sql', import.meta.url),
  'utf8',
);

function functionBody(name: string): string {
  const start = attachmentMigration.indexOf(`function public.${name}(`);
  expect(start, `missing RPC definition: ${name}`).toBeGreaterThanOrEqual(0);
  const next = attachmentMigration.indexOf('create or replace function public.', start + 1);
  return attachmentMigration.slice(start, next === -1 ? undefined : next);
}

describe('customer attachment authorization does not trust tenant headers', () => {
  it('authorizes order attachment using the order restaurant and customer ownership', () => {
    const body = functionBody('attach_customer_to_order');
    expect(body).toContain('v_order.restaurant_id');
    expect(body).toContain('v_customer.auth_user_id is distinct from auth.uid()');
    expect(body).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id)');
    expect(body).toContain("s.role = 'cashier'");
    expect(body).not.toContain('get_request_restaurant_id');
    expect(body).not.toContain('request.headers');
  });

  it('authorizes pending-payment attachment using the payment restaurant and customer ownership', () => {
    const body = functionBody('attach_customer_to_pending_online_payment');
    expect(body).toContain('v_payment.restaurant_id');
    expect(body).toContain('auth_user_id = auth.uid()');
    expect(body).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(body).toContain("v_payment.status <> 'pending'");
    expect(body).not.toContain('get_request_restaurant_id');
    expect(body).not.toContain('request.headers');
  });
});
