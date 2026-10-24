# System Admin / Restaurant Platform Isolation — 2026-10-24

## Change summary

The production Supabase project was updated by migration `20261024100000_isolate_system_admin_from_restaurant_data`. The migration is also committed in this repository. It changes authorization only and does not delete or rewrite users, restaurants, orders, or operational records.

## Enforced boundaries

- Removed System Admin select/insert/update/delete policies from `public.restaurants`; retained tenant-owner and public storefront behavior.
- Removed System Admin cross-tenant reads for taxpayer profiles, POS sales journal, POS sales-reading previews, invoice issuance configuration, issued sales documents, and issued-document events. Replaced those read policies with restaurant-owner-scoped policies.
- Updated owner-facing RPC authorization so System Admin status alone no longer authorizes access to BIR readiness, taxpayer profiles, POS sales journal/reading previews, tax snapshot statuses/amounts, or taxpayer-profile/tax-basis writes. Existing owner access and explicitly permitted cashier read paths remain.
- Revoked authenticated execution of System Admin RPCs for restaurant owner/staff identity inspection, restaurant settings, online-payment settings, invoice-series configuration, non-VAT tax-basis review, taxpayer-profile review, tenant deletion, and restaurant-specific Mapbox usage.
- Updated the restaurant workflow-settings trigger so the restaurant owner, rather than System Admin, is authorized to change the protected workflow settings.
- Removed the System Admin non-VAT review page from the restaurant application route. The route now directs users to the separate platform administration workspace.

## Live verification performed

Post-migration SQL confirmed:
- The targeted operational tables have owner-only read policies; no policy named for System Admin remains on the sensitive tax/sales/document tables.
- Owner-facing tax and sales RPCs remain executable by `authenticated` and their definitions no longer contain a System Admin authorization branch in the access guard.
- Targeted System Admin tenant-inspection/mutation RPCs have `authenticated` EXECUTE disabled.
- Existing platform support ticket and System Admin audit/administrative policies were not removed by this migration; they remain separate platform-support/audit functions rather than restaurant order/POS/tax data access.

## Scope and limitations

- This is a separation of restaurant operational data and tax/sales administration, not deletion of the System Admin identity or the entire platform administration schema.
- Public storefront access for active restaurants remains available to anonymous/authenticated visitors as required by the public ordering experience.
- Supabase `service_role` and database-owner access remain privileged server/database credentials; they must never be exposed to browsers.
- The checks above are catalog/definition checks. Automated build/test workflow results and role-based runtime negative tests must be reviewed separately before describing the entire system as fully verified.
- Official invoice issuance remains disabled; this change does not enable BIR issuance or change regulatory approval status.
