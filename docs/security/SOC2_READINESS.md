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


### Security Advisor refresh — 2026-10-12
- Ran the Supabase Security Advisor against the connected production project. The latest response still reports 10 RLS-enabled tables without policies, 11 `SECURITY DEFINER` functions executable by `anon`, 89 executable by `authenticated`, and leaked-password protection disabled.
- The anonymous `SECURITY DEFINER` findings include public checkout/order creation and guest status lookups, which are product entry points and must not be blanket-revoked. They also include public configuration lookups such as restaurant tax settings, domain resolution, and public self-ordering eligibility. Each signature needs review for safe `search_path`, tenant isolation, input validation, and minimal return fields.
- The authenticated findings include high-impact system-admin and restaurant mutation RPCs. Advisor presence alone does not prove a vulnerability because some functions perform internal role checks, but it is a priority authorization review.
- No global grant changes were made: broad revocation risks breaking checkout and operational workflows, and broad policies on the ten no-policy tables could expose privileged data.
- Open configuration item: leaked-password protection is disabled in Supabase Auth. Enable it in the Auth password/security settings after confirming the customer/staff passwordless and Google OAuth flows are not unintentionally changed. This setting is not changed by a database migration.
- Next review sequence: inventory the 11 anonymous function signatures and verify source-level guards; start with `get_online_payment_status(text)` and `get_order_status_by_id(uuid)` because they expose bearer-credential status lookups, then review public checkout RPCs and their rate-limit/abuse controls. Separately audit admin mutation RPCs reported for `authenticated`.


### Public RPC source review — 2026-10-12
- Reviewed repository source for `get_online_payment_status(text)`, `resolve_restaurant_by_domain(text)`, `get_restaurant_tax_settings(uuid)`, and `restaurant_public_self_ordering_enabled(uuid)` against the anonymous-function Advisor findings.
- `get_restaurant_tax_settings(uuid)` has an internal authorization check requiring the restaurant owner or an active cashier staff membership matching `auth.uid()`; its migration grants execution only to `authenticated`. The Advisor's anonymous finding may reflect historical/stale privilege state, so confirm current live grants before changing this function.
- `restaurant_public_self_ordering_enabled(uuid)` returns a boolean only and checks active restaurant, ordering enabled, active unexpired subscription, active self-ordering module, and module override. Anonymous access is consistent with public storefront gating.
- `resolve_restaurant_by_domain(text)` is intentionally public for custom-domain storefront resolution and filters to active restaurants matching the hostname. It returns public storefront fields including contact number and email. The caller currently maps both into `RestaurantConfig`; reducing those fields requires checking the storefront's contact UX and public restaurant lookup path before changing the RPC contract.
- `get_online_payment_status(text)` returns payment status, order number, order UUID, and total to a caller possessing the payment reference. Payment references are generated with a timestamp and random UUID-derived suffix, lengthened by migration `20261010141000_secure_customer_order_tracking.sql`; however, the RPC does not require customer authentication and returns no customer ownership check. Treat the reference as a bearer secret, avoid logging it, and test that references are unguessable and cannot be enumerated. A token-based follow-up is recommended if reference leakage risk is unacceptable.
- No production permissions or RPC return contracts were changed during this review. The historical Advisor snapshot alone is not sufficient evidence to revoke execution; compare current live grants with the migrations and call sites first.

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


### System Admin helper authorization — live grant verification (2026-10-12)
- Queried live `pg_proc`/ACL metadata for `is_system_admin()`, `system_admin_is_owner()`, `system_admin_has_access()`, `system_admin_has_manage_access()`, and `get_my_system_admin_status()`.
- All five are SECURITY DEFINER with explicit function search_path settings. Live EXECUTE roles were `authenticated` and `postgres`; no `anon` or `PUBLIC` EXECUTE grant was present in the effective ACL.
- `is_system_admin()` and `system_admin_is_owner()` require the JWT role to be `system_admin` and JWT AAL to be `aal2`; owner helper also requires an active `owner` row in `system_admin_access`.
- `system_admin_has_access()` and `system_admin_has_manage_access()` require JWT AAL2 plus an active access row, with access-level allowlists; management excludes `view_only`.
- This is a live database ACL and function-setting check, not proof that every downstream admin RPC calls the correct helper. Continue auditing individual admin mutation functions and ensure MFA is actually enrolled/required in Supabase Auth.


### System Admin bootstrap MFA hardening — 2026-10-12
- Live review found `system_admin_bootstrap_owner()` was executable by authenticated users and checked the `app_metadata.role = system_admin` claim, but did not require JWT AAL2. The bootstrap is intended to be available only while `system_admin_access` is empty; live pre-change state had one access row and one active owner.
- Added migration `20261012190000_require_mfa_for_system_admin_bootstrap.sql` and applied the function replacement to the connected Supabase project. The one-time bootstrap now requires a non-null authenticated user, the System Admin app_metadata role, and `aal2` before inserting the owner row; the empty-table one-time guard remains.
- Post-apply live verification confirmed the deployed function includes the AAL2 check and EXECUTE roles remain `authenticated, postgres`, with no anon/PUBLIC grant.
- This is code and live database hardening; no bootstrap invocation was attempted and no access rows were changed. Runtime negative tests with non-AAL2 JWTs and a first-time bootstrap test remain unperformed because no disposable project was used.


### System Admin active-allowlist identity enforcement — 2026-10-12
- During the privileged RPC audit, several read RPCs relied on `public.is_system_admin()`. Before this change, that helper checked the trusted app_metadata role and AAL2 but did not check the current `system_admin_access` allowlist. A revoked/deactivated account with a stale role claim could therefore still pass those read checks.
- Added and applied `20261012193000_require_active_allowlist_for_system_admin_identity.sql`. The helper now requires authenticated `auth.uid()`, the trusted System Admin role, JWT AAL2, and an allowlist row with `is_active=true`, `status='active'`, and an approved access level.
- Post-apply live SQL confirmed the deployed definition and effective EXECUTE roles (`authenticated, postgres`; no anon/PUBLIC grant). Live state currently has one active access row.
- This central helper change hardens all callers that rely on `is_system_admin()`. No user access records were modified. Revoked-user JWT negative tests and per-RPC integration tests remain outstanding.


### System Admin owner-status consistency review — 2026-10-12
- Production follow-up completed: migration `system_admin_owner_active_status` was successfully applied to Supabase on 2026-10-12. Live catalog verification confirms `system_admin_is_owner()` now requires non-null `auth.uid()`, System Admin app-metadata role, JWT AAL2, and an allowlist row with `is_active = true`, `status = 'active'`, and `access_level = 'owner'`. Effective EXECUTE roles verified: `authenticated` and `postgres`; no `anon` or `PUBLIC` grant appeared. This verifies deployed definition and grants, but does not replace end-to-end tests using revoked/inactive identities.

- Code commit `819e97db78b0a7e195bc8503fefb6c76eb707461` adds migration `20261012200000_require_active_status_for_system_admin_owner.sql`. It aligns `system_admin_is_owner()` with the active-status condition already enforced by `is_system_admin()`: the caller must be authenticated, have the System Admin app-metadata role, JWT AAL2, and an allowlist row with `is_active = true`, `status = 'active'`, and `access_level = 'owner'`.
- **Status correction (2026-10-12):** the migration was subsequently applied successfully to live Supabase, and live catalog verification confirmed the deployed definition and effective EXECUTE grants (`authenticated`, `postgres`; no `anon`/`PUBLIC`). The earlier sentence saying it was not confirmed applied is stale and superseded by the later production follow-up above.
- Regression tests still needed: inactive-status owner row, disabled owner row, non-owner access level, missing AAL2, and revoked/no allowlist row must all deny owner access; active owner at AAL2 should pass. Use staging/test identities and avoid changing the live administrator allowlist as a test.


### System Admin authentication audit-log input validation — 2026-10-12
- Migration `20261012203000_validate_system_admin_auth_audit_inputs.sql` committed as `a4fd3974f70a0e8a9ee798d6ce8cd85283377d7b` and applied successfully to the live Supabase project.
- Hardened `system_admin_record_auth_event(text,text,jsonb)`: explicitly rejects NULL or non-allowlisted event types, blank or over-120-character actions, non-object details, and details over 4096 serialized bytes. Audit rows remain attributed to `auth.uid()`; callers cannot supply another admin's identity. Execute grants verified as `authenticated` and `postgres`, with no `anon` or `PUBLIC` grant shown.
- Live catalog verification confirmed the deployed function definition and grants. Negative/positive RPC integration tests and review of sensitive data placed in `p_details` remain outstanding; the size/type checks do not automatically redact secrets.


### Guest online-payment status reference validation — 2026-10-12
- Added `supabase/migrations/20261012210000_validate_online_payment_status_reference.sql`, commit `0b1d83f9ec12d4853a76fdf206a21d6c3037adc1`, and applied it successfully to live Supabase.
- `get_online_payment_status(text)` now returns no rows for NULL, over-64-character, or malformed reference input; accepted syntax is `PAY-YYYYMMDD-HHMMSS-` plus 32 hexadecimal characters, matching the 128-bit UUID-material references generated by the live pending-payment creation RPCs.
- Live `pg_get_functiondef` confirms the deployed input guards. This is input-shape hardening, not a replacement for rate limiting or protection against accidental leakage of valid bearer references. Payment reference enumeration/rate limiting, integration tests, and guest order tracking token redesign remain outstanding.


### Additional guest-tracking rider identity redaction — 2026-10-12
- Applied a live replacement of `get_order_status_by_id(uuid)` so anonymous callers receive NULL for rider name as well as rider phone and delivery-failure detail. Authenticated behavior is preserved.
- Verified the live function definition contains all three anonymous redaction expressions.
- Migration committed as `supabase/migrations/20261012223000_redact_rider_name_from_guest_order_tracking.sql`, commit `925522a1a31a2edc29d7d9d6290001d38e6e988b`.
- This reduces disclosure but does not fix UUID-as-bearer access; the dedicated high-entropy guest tracking token redesign and end-to-end tests remain open.

### Guest tracking data minimization — 2026-10-12
- Added migration `supabase/migrations/20261012213000_redact_private_fields_from_guest_order_tracking.sql`, commit `c00ff52e608f24927462790d575d85e174530a32`, and applied it successfully to live Supabase.
- Live function definition inspected after deployment: anonymous calls to `get_order_status_by_id(uuid)` now receive NULL for rider phone and delivery-failure detail. Authenticated calls preserve existing field behavior, subject to the function's existing customer ownership check.
- This is an interim data-minimization measure, not a complete guest tracking authorization fix: guest tracking still treats the order UUID as a bearer credential and still returns other order details. End-to-end high-entropy guest tracking token design and checkout/payment-return integration remain outstanding.


### Restaurant tax-settings RPC anonymous grant removal — 2026-10-12
- Live catalog review found `get_restaurant_tax_settings(uuid)` was executable by `anon` despite its internal owner/active-cashier check and its intended authenticated-only use.
- Applied a least-privilege grant migration: revoked `PUBLIC` and `anon` EXECUTE, retained `authenticated` and `postgres` EXECUTE.
- Post-change live privilege checks confirmed `anon_exec=false`, `auth_exec=true`, and `postgres_exec=true`.
- Migration committed as `supabase/migrations/20261012224000_restrict_restaurant_tax_settings_to_authenticated.sql`, commit `18a7b2648278ca2fb369a808a0f723b56c3618ec`.
- A client-side authenticated workflow smoke test remains outstanding; this change does not affect anonymous public checkout RPCs.

