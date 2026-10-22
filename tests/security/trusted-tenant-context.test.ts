import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const identityMigration = readFileSync(
  new URL('../../supabase/migrations/20261023040000_enforce_customer_single_tenant_identity.sql', import.meta.url),
  'utf8',
);
const rpcMigration = readFileSync(
  new URL('../../supabase/migrations/20261023050000_guard_customer_tenant_rpcs.sql', import.meta.url),
  'utf8',
);

describe('customer tenant isolation regression guard', () => {
  it('rejects attaching one authenticated identity to multiple restaurant profiles', () => {
    expect(identityMigration).toContain('create or replace function public.enforce_customer_single_tenant()');
    expect(identityMigration).toContain('before insert or update of auth_user_id, restaurant_id');
    expect(identityMigration).toContain('cp.auth_user_id = new.auth_user_id');
    expect(identityMigration).toContain('cp.restaurant_id <> new.restaurant_id');
    expect(identityMigration).toContain("using errcode = '23505'");
  });

  it('requires the authenticated user to have exactly one customer tenant', () => {
    expect(identityMigration).toContain('create or replace function public.customer_identity_is_single_tenant(');
    expect(identityMigration).toContain('p_auth_user_id = auth.uid()');
    expect(identityMigration).toContain('and not exists (');
    expect(identityMigration).toContain('cp.restaurant_id <> p_restaurant_id');
    expect(identityMigration).toContain('set search_path = public\nas $$\n  select p_auth_user_id = auth.uid()');
    expect(identityMigration).not.toContain('\nas $\n');
  });

  it('guards customer profile, loyalty, order-history, and address RPCs with the identity check', () => {
    for (const rpcName of [
      'get_my_customer_profile',
      'get_my_loyalty_points',
      'get_my_order_history',
      'get_my_customer_addresses',
      'save_my_customer_address',
    ]) {
      const rpcStart = rpcMigration.indexOf(`function public.${rpcName}(`);
      expect(rpcStart, `missing RPC definition: ${rpcName}`).toBeGreaterThanOrEqual(0);

      const nextFunction = rpcMigration.indexOf('create or replace function public.', rpcStart + 1);
      const rpcBody = rpcMigration.slice(rpcStart, nextFunction === -1 ? undefined : nextFunction);
      expect(rpcBody, `${rpcName} must check the authenticated customer's tenant`).toContain(
        'public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)',
      );
    }
  });
});
