import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const singleTenantMigration = readFileSync(
  new URL('../supabase/migrations/20261023040000_enforce_customer_single_tenant_identity.sql', import.meta.url),
  'utf8',
);
const rpcGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261023050000_guard_customer_tenant_rpcs.sql', import.meta.url),
  'utf8',
);
const profileIdGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261023060000_guard_customer_profile_id_rpc.sql', import.meta.url),
  'utf8',
);
const loyaltyRedemptionGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261023070000_guard_loyalty_redemption_tenant_context.sql', import.meta.url),
  'utf8',
);
const customerAttachmentGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261023080000_guard_customer_attachment_rpcs.sql', import.meta.url),
  'utf8',
);


const customerAddressGuardMigration = readFileSync(
  new URL('../supabase/migrations/20261023090000_guard_customer_address_update_and_rls.sql', import.meta.url),
  'utf8',
);

describe('customer tenant-isolation migration contract', () => {
  it('blocks linking one authenticated customer identity to multiple restaurants', () => {
    expect(singleTenantMigration).toContain('create trigger customer_profiles_single_tenant_guard');
    expect(singleTenantMigration).toContain('cp.auth_user_id = new.auth_user_id');
    expect(singleTenantMigration).toContain('cp.restaurant_id <> new.restaurant_id');
    expect(singleTenantMigration).toContain("using errcode = '23505'");
  });

  it('keeps guest profiles outside the authenticated identity guard', () => {
    expect(singleTenantMigration).toContain('new.auth_user_id is not null');
    expect(singleTenantMigration).toContain('Guest checkout is unaffected');
  });

  it.each([
    'get_my_customer_profile',
    'get_my_loyalty_points',
    'get_my_order_history',
    'get_my_customer_addresses',
    'save_my_customer_address',
    'set_my_customer_address_default',
    'delete_my_customer_address',
    'save_my_default_delivery_address',
  ])('guards %s against cross-tenant customer identities', (rpcName) => {
    const functionStart = rpcGuardMigration.indexOf(`function public.${rpcName}(`);
    expect(functionStart, `missing RPC definition: ${rpcName}`).toBeGreaterThanOrEqual(0);

    const nextFunctionStart = rpcGuardMigration.indexOf(
      'create or replace function public.',
      functionStart + 1,
    );
    const functionDefinition = rpcGuardMigration.slice(
      functionStart,
      nextFunctionStart === -1 ? undefined : nextFunctionStart,
    );

    expect(functionDefinition).toContain('public.customer_identity_is_single_tenant');
    expect(functionDefinition).toContain('public.get_request_restaurant_id()');
  });

  it('guards self-order loyalty redemption while preserving authorized staff redemption', () => {
    const pendingPaymentRpc = loyaltyRedemptionGuardMigration.slice(
      loyaltyRedemptionGuardMigration.indexOf('function public.redeem_loyalty_reward_for_pending_payment('),
      loyaltyRedemptionGuardMigration.indexOf('create or replace function public.redeem_loyalty_reward('),
    );
    expect(pendingPaymentRpc).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(pendingPaymentRpc).toContain('v_payment.restaurant_id <> public.get_request_restaurant_id()');

    const redemptionRpc = loyaltyRedemptionGuardMigration.slice(
      loyaltyRedemptionGuardMigration.indexOf('function public.redeem_loyalty_reward('),
    );
    expect(redemptionRpc).toContain('if not v_staff_authorized then');
    expect(redemptionRpc).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id)');
    expect(redemptionRpc).toContain('r.owner_id = auth.uid()');
    expect(redemptionRpc).toContain("s.role = 'cashier'");
  });

  it('guards legacy customer upsert and attachment RPCs against cross-tenant identities', () => {
    expect(customerAttachmentGuardMigration).toContain('cp.restaurant_id <> p_restaurant_id');
    expect(customerAttachmentGuardMigration).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id)');
    expect(customerAttachmentGuardMigration).toContain('public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id)');
    expect(customerAttachmentGuardMigration).toContain('v_staff_authorized');
    expect(customerAttachmentGuardMigration).toContain('s.role = \'cashier\'');
  });

  it('guards the customer profile ID lookup against forged tenant context', () => {
    expect(profileIdGuardMigration).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(profileIdGuardMigration).toContain('p_restaurant_id <> public.get_request_restaurant_id()');
  });

  it('guards legacy address updates and direct address-table access by tenant', () => {
    const updateRpc = customerAddressGuardMigration.slice(
      customerAddressGuardMigration.indexOf('function public.update_my_customer_address('),
      customerAddressGuardMigration.indexOf('revoke all on function public.update_my_customer_address('),
    );
    expect(updateRpc).toContain('public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)');
    expect(updateRpc).toContain('p_latitude double precision');
    expect(updateRpc).toContain('latitude = p_latitude');
    expect(customerAddressGuardMigration).toContain('public.update_my_customer_address(uuid, uuid, text, text, text, text, double precision, double precision, text)');
    expect(updateRpc).toContain('p_restaurant_id <> public.get_request_restaurant_id()');

    for (const policy of [
      'customer_addresses_select_own',
      'customer_addresses_insert_own',
      'customer_addresses_update_own',
      'customer_addresses_delete_own',
    ]) {
      const policyStart = customerAddressGuardMigration.indexOf(`create policy ${policy}`);
      expect(policyStart, `missing address policy: ${policy}`).toBeGreaterThanOrEqual(0);
      const nextPolicyStart = customerAddressGuardMigration.indexOf(
        'create policy ',
        policyStart + 1,
      );
      const policyDefinition = customerAddressGuardMigration.slice(
        policyStart,
        nextPolicyStart === -1 ? undefined : nextPolicyStart,
      );
      expect(policyDefinition).toContain('public.get_request_restaurant_id()');
      expect(policyDefinition).toContain('public.customer_identity_is_single_tenant');
      expect(policyDefinition).toContain('cp.restaurant_id = customer_addresses.restaurant_id');
    }
  });

  it('fails closed for existing duplicate identities in profile access policies', () => {
    expect(singleTenantMigration).toContain('public.customer_identity_is_single_tenant(auth.uid(), customer_profiles.restaurant_id)');
    expect(singleTenantMigration).toContain('create policy "Customers can read own profile"');
    expect(singleTenantMigration).toContain('create policy "Customers can update own profile"');
  });
});
