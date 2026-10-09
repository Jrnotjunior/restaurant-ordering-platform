# Database Architecture and Scalability Audit

**Audit date:** 2026-10-10  
**Scope:** Connected Supabase development project and repository migration conventions  
**Status:** Initial inventory complete; dependency tracing and runtime verification remain open.

## Safety and scope

This audit is intentionally non-destructive. No table, data, grant, policy, function, or trigger was changed during inventory. Do not move tables out of `public`, rename applied migrations, or revoke public RPC execution in bulk. Supabase/PostgREST clients and existing checkout, POS, dispatch, invitation, and payment flows depend on current names and grants.

## Live inventory snapshot

Read from the connected Supabase project:

- 27 base tables in `public`
- 0 views in `public`
- 121 public functions/procedures reported by catalog inventory (function security review should include overloads)
- 22 non-internal triggers
- 48 RLS policies
- 0 public tables with RLS disabled
- 9 tables flagged by Supabase security advisor as RLS enabled with no policies
- 32 SECURITY DEFINER functions were reported executable by `anon` by the advisor/catalog snapshot; each requires intent review, not blanket revocation.
- Six functions flagged for mutable `search_path`.
- Multiple permissive policies flagged on `delivery_assignments`, `orders`, `restaurant_staff`, and `restaurants`.

These counts are a point-in-time snapshot and can change as migrations are applied.

## Proposed logical modules

| Module | Tables | Ownership boundary |
|---|---|---|
| Tenant and identity | `restaurants`, `restaurant_staff`, `tenant_invitations` | Tenant identity, ownership, staff and invitation lifecycle |
| Catalog and storefront | `categories`, `products`, `restaurant_website_customizations` | Public menu and storefront content; owner-managed catalog |
| Orders and POS | `orders`, `order_items`, `order_discount_beneficiaries`, `restaurant_order_counters` | Order lifecycle, immutable item snapshots, cashier discounts and tax snapshots |
| Payments | `pending_online_payments`, `restaurant_paymongo_accounts`, `paymongo_webhook_events` | Checkout staging, payment integration state and webhook idempotency |
| Delivery | `delivery_assignments`, `delivery_quotes` | Delivery quotes, rider assignment and delivery lifecycle |
| Customers and loyalty | `customer_profiles`, `customer_addresses`, `customer_loyalty_accounts`, `loyalty_transactions` | Customer-owned data, restaurant-scoped loyalty and ledger |
| System administration and plans | `system_admin_access`, `system_admin_audit_logs`, `system_packages`, `system_modules`, `system_package_modules`, `restaurant_subscriptions`, `restaurant_module_overrides`, `system_api_usage_events` | Platform-level access, audit, subscription and usage reporting |
| Cross-cutting database infrastructure | Triggers and shared functions | Updated timestamps, authorization helpers, notifications and controlled transaction boundaries |

These are logical modules, not a recommendation to move tables into separate PostgreSQL schemas immediately. Preserve current public API compatibility while boundaries are clarified.

## Key risks and evidence

### P0 — Authorization and exposed RPCs

The security advisor reports anonymous execution for many SECURITY DEFINER functions. Public order creation and status lookups may be intentional, while staff/admin mutation functions and internal trigger helpers may not be. Build an explicit allowlist by function signature, trace each call site and verify that every SECURITY DEFINER function:
- uses a fixed safe `search_path` (or schema-qualifies all objects);
- validates tenant, role and resource ownership internally;
- exposes only required arguments and return fields;
- has EXECUTE grants only for intended roles.

Do not remove anonymous execution from checkout/status RPCs until their call paths are traced and a replacement is tested.

### P0 — Column exposure and grants

The `restaurants` row policy only filters rows; it does not hide sensitive columns such as `owner_id`, tax settings and delivery coordinates. Inventory actual table/column grants and every client select shape. Prefer an explicit public storefront projection/view or a narrowly selected DTO for public consumers. Revoke unnecessary grants only after proving all existing consumers work with the replacement.

The live grant snapshot also showed anonymous grants on `delivery_assignments` and `orders`. RLS currently restricts row access, but direct grants should be least-privilege and intentional; check RPCs and frontend callers before changing them.

### P1 — RLS coverage and policy semantics

Nine tables have RLS enabled without policies according to the advisor. This can be a safe deny-by-default design when direct access is not required, but it can also indicate broken workflows. For each table, record expected readers/writers, direct API usage, grants, and whether service-role-only access is intended.

Several tables have multiple permissive policies. PostgreSQL OR-combines permissive policies, so each policy must be reviewed as part of the whole table/action/role policy set. Consolidate only when the combined behavior is proven equivalent and role matrix tests pass.

### P1 — Function safety and correctness

Six functions have mutable search-path warnings: `set_updated_at`, `update_restaurant_rider_updated_at`, `update_restaurant_product`, `delete_restaurant_product`, `update_restaurant_product_image`, and `set_restaurant_website_customization_updated_at`. Inspect complete definitions and dependent objects before setting a fixed search path. For SECURITY DEFINER functions, schema-qualify references and set a safe search path.

### P1 — Tenant integrity

Tenant-owned records should have a clear `restaurant_id` boundary. Prefer composite foreign keys where a child references multiple tenant-owned parents (for example product/category and order/delivery assignment relationships), and indexes matching tenant-scoped joins and common filters. Do not add constraints until checking existing data for violations.

### P2 — Query performance and growth

Review query plans and representative data volumes before adding or removing indexes. Advisor “unused index” findings are not enough to delete indexes in a small development dataset. Prioritize tenant-key indexes, order chronology/status, rider assignment lookup, foreign-key joins, and uniqueness/idempotency constraints based on actual query patterns.

## Migration and code organization rules

1. Every schema change is an append-only migration in `supabase/migrations/`; never rewrite a migration already applied to the shared database.
2. Use one focused migration per logical concern; document intended grants, policies and rollback/forward-fix strategy.
3. Keep UI out of database policy design: module repositories are the client database boundary, and business authorization must still be enforced server-side.
4. Keep payment/checkout, tax/discount, loyalty ledger, delivery assignment, invitation lifecycle and tenant onboarding changes separate.
5. Use the development project and the designated test restaurant for non-destructive runtime verification.
6. For each change, compare the migration repository with `supabase_migrations.schema_migrations`, run catalog checks, run `npm run build` where code changes exist, and exercise a role-based regression matrix.
7. Never claim an API/browser role test or build passed unless it was actually executed.

## Implementation plan

1. **Inventory parity:** compare repository migrations with live migration history; identify unapplied, missing, and duplicate-named migrations.
2. **RPC authorization matrix:** enumerate SECURITY DEFINER functions by exact signature, callers, grants, tenant checks, search path, and safe intended roles.
3. **Public data boundary:** map storefront fields and add a compatibility-preserving public projection; audit all selects before tightening grants.
4. **RLS table matrix:** document intended role × operation for every table, especially the nine no-policy tables and cross-role order/dispatch tables.
5. **Tenant integrity:** verify tenant composite relationships, orphan records, unique constraints, and supporting indexes using read-only checks.
6. **Query performance:** profile high-traffic list/report queries and add only evidence-based indexes.
7. **CI foundation:** add deterministic type/build checks and database migration/policy static checks; add automated tests for tenant isolation and role access.
8. **Incremental rollout:** one small PR/migration at a time, development runtime verification, then merge and deployment only after evidence is recorded.

## Exit criteria

The database is not considered fully audited or scalable until:
- every exposed SECURITY DEFINER function has a reviewed purpose, safe search path, authorization contract and minimal EXECUTE grant;
- public clients cannot read private tenant configuration or another tenant's data;
- every table has a documented direct-access/service-only decision and role matrix;
- tenant relationships and critical uniqueness/idempotency rules are verified;
- representative query plans and indexes are reviewed;
- migration history is reconciled;
- build/CI and role-based regression tests have actual passing results.
