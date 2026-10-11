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
- Atomic-claim remediation committed on 2026-10-12: migration `20261012150000_claim_paymongo_webhook_events_atomically.sql` adds service-role-only RPC `claim_paymongo_webhook_event`. It atomically claims an event, permits retry of failed events, and permits recovery of processing claims older than five minutes. The Edge Function calls the RPC before side effects, returns 200 for processed duplicates, and 409 for an event already processing.
- Live deployment completed on 2026-10-12: migration applied successfully; read-only catalog query confirmed `claim_paymongo_webhook_event` exists. `information_schema.routine_privileges` listed only `postgres` and `service_role` as EXECUTE grantees. Edge Function `paymongo-webhook` deployed successfully as ACTIVE version 14 with `verify_jwt=false`, preserving the existing PayMongo HMAC authentication model. A subsequent live fetch confirmed version 14 source contains the atomic-claim RPC call. Concurrency, failed-retry, and stale-claim recovery tests have not yet been run.
- The webhook event table migration enables RLS and grants authenticated users SELECT under a restaurant-owner policy, while service_role has select/insert/update. Review whether exposing `last_error` and event metadata to restaurant owners is appropriate; do not expose secret values.


### Guest checkout NULL-validation hardening — deployed 2026-10-12
- Found SQL three-valued-logic gaps in exposed checkout RPCs: `IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0` does not reject SQL NULL reliably, and `p_order_type NOT IN (...)` / `p_payment_method NOT IN (...)` likewise do not explicitly reject NULL.
- Added migration `20261012180000_harden_all_guest_checkout_rpc_validation.sql` (commit `9ca54018d8f4a5057956ae37cf7eef7033f2ae81`). It rewrites only these validation predicates in the six current checkout RPC overloads using each live function definition, preserving business logic and grants. The migration applied successfully to the live Supabase project.
- Live catalog verification confirmed explicit NULL/non-array/empty-item guards in the base `create_order`, quote-based order creation, both `create_pending_online_payment` overloads, and quote-based pending payment. The customer-location `create_order` overload delegates to the hardened base function; the customer-location pending-payment overload delegates to the hardened pending-payment base function.
- Live rollback-free validation probes passed for the base `create_order`: SQL NULL items, scalar JSON, object JSON, and empty arrays were rejected with `At least one item is required`; NULL order type was rejected with `Invalid order type`; NULL payment method was rejected with `Invalid payment method`. The test inputs were rejected before order creation; no test orders were created.
- Remaining: add repeatable automated regression tests and verify the client-facing REST RPC path in a non-production/staging test setup. Do not interpret these targeted checks as a complete guest-checkout abuse/rate-limit review.

## Supabase Security Advisor snapshot
- Security Advisor observed 10 RLS-enabled tables with no policies on 2026-10-11: `delivery_quotes`, `delivery_route_rate_limits`, `pending_online_payments`, `restaurant_module_overrides`, `restaurant_order_counters`, `restaurant_subscriptions`, `system_admin_access`, `system_modules`, `system_package_modules`, `system_packages`.
- 11 `SECURITY DEFINER` functions were reported executable by `anon`; 89 were reported executable by `authenticated`. These counts require per-function review; do not apply blanket revokes.

### Live table-grant review (2026-10-12)
- Read-only catalog inspection confirmed all ten tables above have RLS enabled.
- Table ACLs and `information_schema.role_table_grants` showed table privileges for `postgres` and/or `service_role`, with no listed direct table grants to `anon` or `authenticated` for these ten tables.
- Current evidence therefore does not justify adding broad RLS policies just to silence the linter. The no-policy finding is still worth tracking, but the immediate direct-table exposure risk appears mitigated by the absence of client-role table grants. Recheck effective privileges after any future grants or schema changes.
- `service_role` is privileged and bypasses RLS; its use must remain server-side and secrets must never reach clients.


### Guest order-tracking privacy review — 2026-10-12
- Live read-only inspection of `public.get_order_status_by_id(uuid)` confirmed signed-in requests are filtered to the matching authenticated customer profile, while requests with `auth.uid() IS NULL` can retrieve the order by UUID alone.
- The RPC response includes customer-visible order details and may include a rider's name and mobile number, as well as delivery failure details and tax/discount data. This is a deliberate guest-tracking capability today, but possession of the order UUID currently acts as the guest authorization credential.
- Existing migration `20261010141000_secure_customer_order_tracking.sql` replaced order-number lookup with UUID lookup and made payment references longer. This reduces easy enumeration but does not prevent disclosure if an order UUID leaks through a shared URL, browser history, screenshots, logs, or referrer handling.
- Existing migration `20261012100000_restrict_customer_order_tracking_to_owner.sql` restricts authenticated sessions to their own linked customer profile, but preserves the anonymous UUID-only path.
- No production behavior was changed in this review. Do not revoke anonymous tracking without a replacement: the frontend calls `get_order_status_by_id` using the order UUID, and anonymous guest tracking is a supported flow.
- Remediation design: issue a separate high-entropy guest tracking token at order creation; store only a cryptographic hash of that token; use a narrowly scoped guest-tracking RPC that validates the token and returns the minimum necessary customer-facing fields; keep authenticated ownership checks on the existing UUID-based RPC; do not return rider phone numbers to anonymous guests unless the product requirement explicitly requires it. Plan token propagation through cash checkout, online-payment success/return flow, and order tracking URLs before rollout.
- Required tests before deployment: token cannot be guessed or reused across orders; wrong/expired token returns no order data; signed-in customer cannot use another customer's order UUID; valid guest token preserves the required tracking timeline; public response excludes unnecessary personal information.

## Work order
1. Test simultaneous duplicate delivery, failed-event retry, and abandoned-claim recovery for the deployed atomic webhook claim.
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
- [x] Atomic webhook event-claim implementation committed to `main`.
- [x] Atomic claim migration applied; live function existence and EXECUTE grants verified.
- [x] Updated `paymongo-webhook` Edge Function deployed as ACTIVE version 14; live source confirmed to contain atomic-claim call.
- [ ] Concurrent duplicate, failed-event retry, and stale-claim recovery tests pass.
- [ ] Production/test secret configuration and fallback independently verified.
- [x] Guest checkout NULL/non-array/empty item and NULL order/payment validation hardened in all live RPC overloads; targeted live rejection probes passed.
- [ ] Anonymous checkout authorization, rate limiting, and broader abuse controls fully reviewed.
- [ ] All privileged RPCs reviewed and security regression tests pass.
- [ ] GitHub Actions build passes on current `main`.
- [ ] Strict no-full-name API contract confirmed throughout the system.
- [ ] Operational SOC 2 evidence assembled and reviewed by a qualified auditor.

Never claim SOC 2 compliance based on this tracker. Repository state is not proof of deployed database state.
