# Web2Table — Order Mutation and Database Permission Hardening Plan

**Date:** 2026-10-20  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Connected Supabase project inspected read-only:** `xaihajwrsvcdjisezmmc`  
**Scope:** `public.orders` mutation authorization, financial-field integrity and dispatch workflows  
**Status:** Verified risk inventory and staged remediation plan. No application or database writes were performed for this audit.

## Summary

The connected database currently gives `anon` and `authenticated` roles table-level UPDATE privilege on `public.orders`. RLS is enabled and remains an important additional boundary.

The current RLS policies do **not** give anonymous users an applicable UPDATE policy for orders, so the anonymous grant alone is not evidence that an anonymous user can successfully edit an order. Do not describe it as a confirmed anonymous exploit.

For authenticated restaurant owners and active dispatchers, however, the row-level update policies allow updating orders within their authorized restaurant, and the broad SQL privilege includes sensitive fields. Read-only privilege checks returned true for authenticated UPDATE access to `orders.total`, `orders.tax_vat_amount`, `orders.payment_status` and `orders.order_number`. This creates an effective integrity risk: an otherwise-authorized owner/dispatcher can potentially directly update fields that should be protected by a server-validated workflow.

The correct fix is **not** a blanket revoke as a first step. Two legitimate dispatch actions currently use direct `orders` updates. Replace them with narrowly scoped server-side RPCs, verify them in an isolated development database, then remove unneeded direct UPDATE grants.

## Live database evidence

Read-only catalogue queries on the connected project confirmed:

- RLS enabled on `public.orders`.
- `Restaurant owners can update orders` policy scoped by restaurant owner and active restaurant.
- `Dispatchers can update orders` policy scoped by active dispatcher staff and active restaurant.
- A restrictive `Require MFA for privileged order access` policy requires `public.privileged_restaurant_mfa_verified()`.
- `privileged_restaurant_mfa_verified()` returns true for restaurant owners/staff only when the JWT authentication assurance level is `aal2`; system admins are likewise expected to satisfy their separate MFA check.
- `anon` and `authenticated` table privileges include UPDATE; column checks show the sensitive UPDATE privileges noted above.
- The inspected owners/dispatchers row policies restrict which rows are writable, not which columns are writable.
- `public.confirm_dine_in_payment` and `public.apply_pos_group_discounts` are SECURITY DEFINER functions owned by `postgres`. This indicates that narrowly validated server functions can perform legitimate order changes without relying on direct browser table updates. Other routines must be audited individually before privilege changes.

These observations come from the connected project's live metadata. They do not prove that anyone has tampered with orders. They also do not identify the connected project as production versus staging with certainty; assume it is sensitive and do not run destructive tests against it.

## Inventory of direct update paths found

### A. Frontend: delivery assignment

**Path:** `src/modules/dispatch/dispatchRepository.ts`, exported as `assignDelivery`  
**Caller:** `src/pages/RestaurantDeliveryDispatchPage.tsx`  
**Current behavior:**
1. UI handler allows dispatch assignment only when the page role is `dispatcher`.
2. Repository inserts a `delivery_assignments` row first.
3. It then directly updates `orders.rider_id`, `orders.delivery_status` and `orders.rider_assigned_at`, conditional on the order ID, restaurant ID and an unassigned delivery status.
4. If the order update fails, it tries to delete the new assignment row and throws an error.

**Problems / risk:**
- Client-side role checks are not an authorization boundary; server-side checks must stand alone.
- The assignment insert and order update are two requests, creating an intermediate partial state.
- The direct order update depends on broad table UPDATE rights.

**Required replacement:** a SECURITY DEFINER RPC such as `assign_delivery_order` that, in one database transaction:
- requires a signed-in user;
- explicitly checks MFA via `privileged_restaurant_mfa_verified()`;
- requires an active dispatcher for the active restaurant (matching the existing dispatch action);
- locks the order row and verifies the order belongs to that restaurant, is a ready delivery, and is still unassigned;
- verifies the selected rider is active and belongs to the same restaurant;
- inserts the active assignment and updates the order’s rider/status fields atomically;
- handles concurrent duplicate assignment using the existing partial unique index and a clear conflict response;
- returns success only after both records are consistent.

The RPC must not trust a role supplied by the browser. Retain the current page's error/reload behavior.

### B. Frontend: pickup / take-out / dine-in handoff

**Path:** `src/modules/dispatch/dispatchRepository.ts`, exported as `completeDispatchHandoff`  
**Caller:** `src/pages/RestaurantDeliveryDispatchPage.tsx`  
**Current behavior:** the UI handler requires the `dispatcher` page role, then directly updates `orders.status` to `completed` with conditional filters requiring the order ID, restaurant ID, order type in the caller and current status `ready`.

**Problems / risk:**
- A client can call the table update directly with different filters/values if table grants and RLS allow the row.
- Transitioning to `completed` triggers consequential inventory and loyalty functions, so the transition needs server-side validation.

**Required replacement:** a SECURITY DEFINER RPC such as `complete_dispatch_handoff` that:
- requires a signed-in user and passes the current MFA requirement;
- requires an active dispatcher for the target restaurant (matching the current UI);
- locks the order row and checks restaurant ownership/scope, status `ready`, and supported order type (`pickup`, `take_out`, `dine_in`);
- applies the completion transition only if the guarded conditions still hold; and
- relies on the existing legitimate order triggers to process completion side-effects once.

Do not add new accounting/tax behavior in this RPC. Avoid changing current dispatch semantics outside the security and atomicity correction without a separate requirement review.

### C. Server-side cancellation/refund functions

Source paths found:
- `supabase/functions/cancel-restaurant-order/index.ts`
- `supabase/functions/cancel-customer-order/index.ts`

These functions use the service-role client for protected changes after server-side validation, including cancellation and refund status. The service-role path is intentionally distinct from authenticated browser table updates. A revoke from `anon` and `authenticated` must not revoke the service-role permissions required by these functions.

Test that the refund failure/success states continue to persist correctly after any privilege migration. Do not weaken token, payment-reference, customer-ownership or refund checks.

### D. Server-side routines and triggers

The database itself mutates orders through validated RPCs and trigger routines, including POS group discount finalization, loyalty redemption, cash-payment confirmation, online-payment finalization, guest cancellation-token handling, order status transitions, automated rider assignment, inventory deductions and loyalty-point awarding.

Before removing table UPDATE grants, confirm the owner of each SECURITY DEFINER routine, execute grants, explicit authorization logic and intended caller. Existing SECURITY DEFINER functions owned by `postgres` are not affected by revoking browser-role UPDATE grants, but their business rules and grants must still be audited. Do not change tax/discount/payment logic as part of this permission change.

## Staged remediation plan

### Phase 0 — Do not touch the connected project

No production-like migration should be applied until tested against an isolated development database. The user’s accessible project list currently shows one active project named “Restaurant Ordering Platform” and one inactive project named “datihan.ph”; no separate active development project was identified. Creating a Supabase development branch requires cost confirmation and may incur hourly charges. No branch was created.

### Phase 1 — Add and test narrow RPCs without removing old grants

Create a new migration containing the two narrow SECURITY DEFINER RPCs. In each function:
- use a fixed `search_path` including `pg_temp` where needed;
- explicitly validate `auth.uid()`, tenant, staff role, active status and MFA;
- do not accept arbitrary status/role values from the client;
- use `FOR UPDATE` and check-and-set predicates to handle concurrent state changes;
- revoke execution from `PUBLIC` and `anon`; grant only to `authenticated`;
- return a predictable error for stale/invalid state;
- preserve normal order trigger effects and ensure one transition causes effects only once.

At this phase keep current table grants so the old deployed UI is not broken before frontend deployment.

### Phase 2 — Switch frontend to RPCs and verify build

Change `assignDelivery` and `completeDispatchHandoff` to use the new RPCs. Add tests for helper/client request behavior where feasible. Run the complete production build and unit-test suite. Review the diff before deployment. The two direct `orders` updates in the browser must be removed before revocation.

### Phase 3 — Validate in isolated Supabase development branch

Apply the migration only to the isolated development database. Verify:
- dispatcher A can assign a valid ready delivery in restaurant A;
- a dispatcher cannot assign another tenant’s order or rider;
- non-dispatcher, disabled staff, unauthenticated user and MFA-unverified user are rejected;
- concurrent assignment attempts cannot create duplicate active assignments;
- only eligible ready pickup/take-out/dine-in orders can be completed by a dispatcher;
- duplicate/stale handoff attempts return a conflict and do not double-trigger effects;
- existing server-side payment, discount, refund, inventory and loyalty functions still behave as intended;
- the browser roles cannot change total, tax snapshots, payment status, discount fields, order number or other protected fields through the REST table endpoint.

Do not simulate these tests by writing to customer transactions in the connected active database.

### Phase 4 — Remove unneeded direct UPDATE rights

Only after Phase 3 succeeds and the updated frontend has been deployed, apply a separate migration revoking table-level UPDATE from `PUBLIC`, `anon` and `authenticated` on `public.orders`. Keep service-role and table-owner rights necessary for verified server-side functions. Recheck effective privileges and all row-level policies after migration. Retain an explicit rollback plan.

RLS owner/dispatcher UPDATE policies should be reviewed for removal or retained as defense in depth once direct browser UPDATE is no longer required. Do not assume policies alone provide column protection.

### Phase 5 — Production rollout

After user approval and development validation:
1. Confirm the exact production project ID and current backup/restore path.
2. Confirm the planned application + migration deployment order and ensure the new RPCs exist before the new frontend starts calling them.
3. Re-run privilege and function-grant queries.
4. Run non-destructive smoke tests through owner/dispatcher accounts.
5. Monitor dispatch assignment, handoff, cancellation/refund logs and order-status errors after rollout.

## Regression acceptance checklist

- [ ] Only the frontend direct order writes listed in A/B remain to be replaced; rerun repository-wide search before release.
- [ ] Authenticated roles can no longer update protected financial and invoice-identity fields directly.
- [ ] Anonymous direct table UPDATE is denied by effective privileges and RLS.
- [ ] Narrow dispatch RPCs enforce tenant, role, MFA and row state server-side.
- [ ] Assignment and order state cannot be left inconsistent by a partial failure.
- [ ] Order completion trigger effects occur once.
- [ ] Service-role cancellation and refunds still update legitimate cancellation/refund fields.
- [ ] POS financial and online-payment RPCs continue to work.
- [ ] No tax formula or historical order row is rewritten by the permissions migration.
- [ ] Build/tests pass, development database checks pass, and deployment status is independently confirmed.

## Explicitly not done

- No direct order UPDATE grant was revoked.
- No RPC or migration was applied to Supabase.
- No order records were modified.
- No production deployment was triggered.
- No actual exploitation of these privileges was observed.
