# SOC 2 Readiness — Engineering Tracker

This is an internal engineering tracker, not a SOC 2 report, certification, or auditor attestation.

## Current findings

### Customer profile RPC contract
- Frontend callers in `src/modules/customer/customerAuthService.ts`, `src/pages/RestaurantOwnerLoginPage.tsx`, and `src/pages/CheckoutPage.tsx` call `upsert_customer_profile` with separate first/last-name arguments.
- Live read-only verification confirmed deployed `upsert_customer_profile(p_restaurant_id uuid, p_first_name text, p_last_name text, p_phone text)` and `get_my_customer_profile_id(p_restaurant_id uuid)`. The deployed upsert checks authentication, tenant context, active restaurant, required names, phone format, and initializes the loyalty account.
- The previously proposed `20261012140000_fix_customer_profile_split_name_rpc.sql` migration was deleted after verification showed the live function signature already matched the frontend contract. Do not describe that migration as present or applied.
- Recheck all RPC return fields and consumers against the strict requirement that a concatenated full-name field should not exist anywhere; do not infer this from the table schema alone.

### Anonymous checkout order RPC
- `public.create_order` is intentionally executable by `anon` and `authenticated` in `supabase/migrations/0066_fix_create_order_checkout_signature.sql`.
- The function recalculates item prices from `public.products` and checks product IDs belong to the supplied restaurant, which are important protections.
- Continue auditing active-restaurant checks, delivery-fee calculation, item JSON validation, rate limiting, and order abuse controls. Do not revoke anonymous execution without replacing guest checkout.

### PayMongo webhook and finalization — reviewed 2026-10-12
- Read `supabase/functions/paymongo-webhook/index.ts` on `main`. The handler verifies a PayMongo HMAC-SHA256 signature over timestamp + raw request body, checks timestamp freshness within 10 minutes, compares signatures without early character mismatch exits, checks event ID, validates checkout session/payment/restaurant metadata, and for paid events checks PHP currency and checkout line items against the pending payment total before calling the finalizer.
- The handler resolves a restaurant-specific webhook secret from the account connection when an organization ID is present, with a global `PAYMONGO_WEBHOOK_SECRET` fallback. Confirm the fallback is intentionally configured and that production/test secrets are separated correctly.
- Live read-only query of `information_schema.routine_privileges` for `public.finalize_online_payment` returned only `postgres` and `service_role` EXECUTE grants; no `anon` or `authenticated` EXECUTE grants were listed. This supports the intended service-role-only boundary for this function.
- Repository migration `20261005180000_record_paymongo_transaction_fees.sql` also revokes execute from `public`, `anon`, and `authenticated`, and grants it to `service_role`.
- Idempotency follow-up: the webhook currently reads an event's status and then upserts it to `processing` before performing payment side effects. The read-then-upsert is not an atomic claim, so simultaneous duplicate deliveries may both enter processing before either is marked processed. Add a concurrency-safe claim/locking mechanism and test duplicate concurrent delivery before calling this control complete.
- The webhook event table migration enables RLS and grants authenticated users SELECT under a restaurant-owner policy, while service_role has select/insert/update. Review whether exposing `last_error` and event metadata to restaurant owners is appropriate; do not expose secret values.

## Supabase Security Advisor snapshot
- Security Advisor observed 10 RLS-enabled tables with no policies on 2026-10-11: `delivery_quotes`, `delivery_route_rate_limits`, `pending_online_payments`, `restaurant_module_overrides`, `restaurant_order_counters`, `restaurant_subscriptions`, `system_admin_access`, `system_modules`, `system_package_modules`, `system_packages`.
- 11 `SECURITY DEFINER` functions were reported executable by `anon`; 89 were reported executable by `authenticated`. These counts require per-function review; do not apply blanket revokes.

### Live table-grant review (2026-10-12)
- Read-only catalog inspection confirmed all ten tables above have RLS enabled.
- Table ACLs and `information_schema.role_table_grants` showed table privileges for `postgres` and/or `service_role`, with no listed direct table grants to `anon` or `authenticated` for these ten tables.
- Current evidence therefore does not justify adding broad RLS policies just to silence the linter. The no-policy finding is still worth tracking, but the immediate direct-table exposure risk appears mitigated by the absence of client-role table grants. Recheck effective privileges after any future grants or schema changes.
- `service_role` is privileged and bypasses RLS; its use must remain server-side and secrets must never reach clients.

## Work order
1. Make webhook event claiming concurrency-safe and test simultaneous duplicate delivery.
2. Verify production/test webhook secret configuration and the global-secret fallback.
3. Audit anonymous `create_order` behavior and abuse protections without breaking guest checkout.
4. Audit privileged functions for tenant/role checks, MFA assurance where required, safe `search_path`, idempotency, and least privilege.
5. Review all no-policy tables' grants and intended access again after relevant schema changes.
6. Remove any legacy concatenated full-name API output if still present and update callers/tests.
7. Add regression tests for authorized and denied cross-tenant access; retain CI, access reviews, incident response, backup/restore, and vendor evidence.

## Verification checklist
- [x] Supabase Security Advisor findings retrieved.
- [x] Live customer-profile RPC signature verified by read-only SQL; deployed function matches frontend argument contract.
- [x] Live ACLs reviewed for the ten no-policy tables; no direct `anon`/`authenticated` table grants were listed.
- [x] Live `finalize_online_payment` EXECUTE grants inspected; only `postgres` and `service_role` were listed.
- [x] Webhook source reviewed for signature verification, freshness, checkout metadata, amount/currency checks, and use of the finalizer.
- [ ] Concurrency-safe webhook event claiming implemented and duplicate-concurrency tests pass.
- [ ] Production/test secret configuration and fallback independently verified.
- [ ] Anonymous checkout authorization and abuse controls reviewed.
- [ ] All privileged RPCs reviewed and security regression tests pass.
- [ ] GitHub Actions build passes on current `main`.
- [ ] Strict no-full-name API contract confirmed throughout the system.
- [ ] Operational SOC 2 evidence assembled and reviewed by a qualified auditor.

Never claim SOC 2 compliance based on this tracker. Repository state is not proof of deployed database state.
