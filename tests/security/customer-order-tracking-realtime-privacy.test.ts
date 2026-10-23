import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repository = readFileSync(
  new URL('../../src/modules/ordering/orderRepository.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../supabase/migrations/20261024090000_disable_public_customer_order_broadcast.sql', import.meta.url),
  'utf8',
);

describe('customer order tracking realtime privacy', () => {
  it('removes the legacy public broadcast trigger', () => {
    expect(migration).toContain('DROP TRIGGER IF EXISTS orders_customer_realtime_trigger ON public.orders');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.notify_customer_order_changed()');
    expect(migration).not.toContain('realtime.send');
  });

  it('does not subscribe to the public broadcast event from the tracking page', () => {
    expect(repository).not.toContain("'broadcast'");
    expect(repository).not.toContain("{ event: 'customer_order_changed' }");
    expect(repository).toContain("'postgres_changes'");
    expect(repository).toContain('filter: `id=eq.${orderId}`');
  });
});
