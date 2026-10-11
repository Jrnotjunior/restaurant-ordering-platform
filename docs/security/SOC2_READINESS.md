# SOC 2 Readiness — Engineering Tracker

This is an internal engineering tracker, not a SOC 2 report, certification, or auditor attestation.

## Current findings

### Customer profile RPC contract
- Frontend callers in `src/modules/customer/customerAuthService.ts`, `src/pages/RestaurantOwnerLoginPage.tsx`, and `src/pages/CheckoutPage.tsx` call `upsert_customer_profile` with separate first/last-name arguments.
- Earlier migrations define the legacy `p_name` argument.
- A forward migration was committed at `supabase/migrations/20261012140000_fix_customer_profile_split_name_rpc.sql` to align the RPC with the split-name schema.
- Status: committed to GitHub; **not confirmed applied to the live Supabase project**. Verify deployed schema and migration history before calling this resolved.

### Anonymous checkout order RPC
- `public.create_order` is intentionally executable by `anon` and `authenticated` in migration `0066_fix_create_order_checkout_signature.sql`.
- The function recalculates item prices from `public.products` and checks product IDs belong to the supplied restaurant, which are important protections.
- Continue auditing active-restaurant checks, delivery-fee calculation, item JSON validation, rate limiting, and order abuse controls. Do not revoke anonymous execution without replacing guest checkout.

### Online payment finalization
- The latest repository migration inspected, `20261005180000_record_paymongo_transaction_fees.sql`, revokes execution of `finalize_online_payment` from `public`, `anon`, and `authenticated`, and grants it to `service_role`.
- This is a safer privilege boundary for a payment finalizer. Verify the migration is applied and verify that the server-side payment callback validates PayMongo events before invoking it.

## Supabase Security Advisor snapshot (observed 2026-10-11)
- 10 RLS-enabled tables reported with no policies: `delivery_quotes`, `delivery_route_rate_limits`, `pending_online_payments`, `restaurant_module_overrides`, `restaurant_order_counters`, `restaurant_subscriptions`, `system_admin_access`, `system_modules`, `system_package_modules`, `system_packages`.
- 11 `SECURITY DEFINER` functions were reported executable by `anon`; 89 were reported executable by `authenticated`. These counts require per-function review; do not apply blanket revokes.

## Work order
1. Verify the customer-profile migration is applied and test signup/login/checkout.
2. Verify PayMongo callback authenticity and service-role-only finalization in the deployed database.
3. Audit anonymous `create_order` behavior and abuse protections without breaking guest checkout.
4. Review each no-policy table's grants and intended access; add least-privilege policies or revoke direct API table privileges as justified.
5. Audit privileged functions for tenant/role checks, safe `search_path`, idempotency, and least privilege.
6. Add regression tests for authorized and denied cross-tenant access; retain CI, access reviews, incident response, backup/restore, and vendor evidence.

## Verification checklist
- [x] Supabase Security Advisor findings retrieved.
- [x] Customer profile RPC mismatch identified and forward migration committed.
- [x] Payment finalizer grants inspected in repository migration.
- [ ] Customer-profile migration applied and verified in live Supabase.
- [ ] GitHub Actions build passes on current `main`.
- [ ] Payment callback and deployed grants independently verified.
- [ ] Security regression tests pass.
- [ ] Operational SOC 2 evidence assembled and reviewed by qualified auditor.

Never claim SOC 2 compliance based on this tracker. Repository state is not proof of deployed database state.
