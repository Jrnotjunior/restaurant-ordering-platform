# Trusted Tenant Context: Security Remediation Design

## Status

**Design gate only — not a security fix.** This document records the trust-boundary requirements before changing tenant resolution or deploying database migrations. The existing customer tenant resolver reads `x-restaurant-domain` and `x-restaurant-slug` from PostgREST request headers. A browser can choose both values, so neither is proof of the tenant the request actually reached.

## Security invariant

A request must not gain access to tenant data merely by choosing a restaurant ID, slug, or tenant header. The database must authorize each read and mutation using authenticated identity and server-established tenant context, or an explicit tenant membership/role check that does not depend on browser-supplied context.

## Required architecture decision

Choose and document one enforceable trust model before implementing:

1. **Trusted server gateway:** Route tenant-scoped data requests through a server/Edge Function that validates the actual request host against the tenant registry, authenticates the caller, and establishes tenant context that clients cannot forge. The database must accept that context only from a credentialed server path unavailable to `anon` and `authenticated` clients.
2. **Explicit authorization model:** Remove ambient hostname-based authorization. Require explicit tenant membership/ownership checks for authenticated customer and staff actions; for public/guest flows, resolve the tenant server-side from a validated host and enforce it in the server handler/database operation.

Do not treat the browser's `Origin`, `Host`, `Referer`, `x-restaurant-domain`, or `x-restaurant-slug` as independently trusted authorization evidence. CORS is not authorization. A signed context is only valid if its signing secret is held server-side and clients cannot mint it.

## Scope inventory

Audit every dependency on `public.get_request_restaurant_id()`, including:

- Customer profile creation and reads
- Loyalty balance and transaction reads
- Order history and customer/order attachment
- Saved-address create, update, default, and delete operations
- RLS policies on customer profile, address, loyalty, order, and related tables
- Guest checkout and public storefront reads
- Restaurant owner, cashier, staff, and rider workflows
- Custom domains, `*.web2table.io` tenant domains, local development, and the GitHub Pages demo

Do not assume that fixing one RPC secures the other RPCs or direct table access. Review SECURITY DEFINER ownership, search paths, grants, and all alternate write paths.

## Required adversarial tests

Tests must run against an isolated disposable Supabase/Postgres test project with representative Restaurant A and Restaurant B fixtures. Text-matching tests may supplement these but do not count as proof of enforcement.

1. An authenticated customer of A cannot read or mutate B's profile, saved addresses, loyalty records, or order history by changing request headers or RPC parameters.
2. A customer cannot attach their profile to another tenant's order or pending payment.
3. A request with missing, malformed, conflicting, or unknown tenant context fails closed.
4. An inactive tenant and an unregistered custom domain do not resolve to another tenant.
5. A forged `x-restaurant-domain` or `x-restaurant-slug` cannot override server-established context.
6. Anonymous/guest checkout works only for the tenant resolved by the trusted server path; payment and order IDs cannot be used to cross tenant boundaries.
7. Authorized restaurant owners and staff retain only their permitted tenant actions.
8. Existing custom-domain, platform-subdomain, and demo-host behavior is covered explicitly.
9. Direct REST table access is tested in addition to RPC calls, including SELECT, INSERT, UPDATE, and DELETE where applicable.
10. Verify service-role-only operations remain inaccessible to `anon` and `authenticated`.

## Delivery gates

- [ ] Inventory all callers of `get_request_restaurant_id()` and affected RLS policies.
- [ ] Select and document the trust model above, including how the database distinguishes server-established context from client headers.
- [ ] Implement the server-side resolver/gateway and database enforcement as one reviewed change.
- [ ] Add database-backed adversarial tests and run them on an isolated test project.
- [ ] Run `npm test`, `npm run build`, SQL lint/migration checks, and guest/staff regression tests.
- [ ] Review migration ordering against the stacked tenant security PRs; avoid duplicate or conflicting function definitions.
- [ ] Deploy only after explicit authorization and a rollback plan.

## Current finding

The legacy migration `supabase/migrations/0090_customer_tenant_context.sql` resolves a tenant from `request.headers` values `x-restaurant-domain` and `x-restaurant-slug`. Since these values are supplied by the caller, checks that compare RPC parameters against this resolver do not establish an independent trust boundary. The proposed security PRs must not be considered production-ready until the architecture and adversarial test gates above pass.

**No production database changes are authorized or performed by this design document.**
