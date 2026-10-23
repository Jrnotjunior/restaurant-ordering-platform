import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261024050000_add_guest_order_tracking_token_hashes.sql', import.meta.url),
  'utf8',
);

describe('guest order-tracking token schema', () => {
  it('stores only a separately named tracking-token hash on orders and pending payments', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS guest_tracking_token_hash text');
    expect(migration).toContain('ALTER TABLE public.orders');
    expect(migration).toContain('ALTER TABLE public.pending_online_payments');
    expect(migration).not.toContain('guest_tracking_token text');
  });

  it('constrains each hash to lowercase 64-character hexadecimal format', () => {
    expect(migration).toContain("guest_tracking_token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('orders_guest_tracking_token_hash_format_check');
    expect(migration).toContain('pending_online_payments_guest_tracking_token_hash_format_check');
  });

  it('is additive and does not revoke the existing tracking RPC before replacement validation', () => {
    expect(migration).toContain('This is additive only');
    expect(migration).not.toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_order_status_by_id/i);
  });
});
