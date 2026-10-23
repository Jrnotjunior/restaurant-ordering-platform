# Web2Table POS — BIR Readiness Implementation Status

**Updated:** 2026-10-23  
**Repository:** `Jrnotjunior/restaurant-ordering-platform` (`main`)  
**Status:** Technical groundwork in progress. **Not BIR-accredited, not a BIR-issued invoice implementation, and not approval to represent this system as compliant.**

## Work completed in this phase

### Tax snapshot provenance

- Added `orders.tax_snapshot_status` and `orders.tax_snapshot_version`.
- Existing orders are marked `legacy_unknown`; no historical amounts, tax rates, or invoices were inferred or backfilled.
- New orders default to `not_calculated` until a server-side routine records a calculation.
- The existing POS tax-finalization routine marks a result `calculated` with version 1 only when the restaurant is VAT-registered and every order line has an explicit `standard_rate` classification. Non-VAT registrations, unclassified lines, VAT-exempt product lines, and zero-rated product lines are marked `requires_review` under the current formula rather than incorrectly treated as complete.
- If a later financial update changes subtotal, delivery fee, discount or order total without recalculating the tax snapshot, the status becomes `requires_review`.
- Tax-support reports now leave tax amounts blank and identify missing/legacy/review-required calculations rather than presenting schema-default zeroes as calculated tax.

### Append-only technical activity journal

- Added `public.pos_sales_journal` with timestamp, database transaction ID, restaurant/order references, event and operation types, actor context, and before/after financial snapshots.
- Added triggers for order, order-item, and statutory discount beneficiary changes.
- The journal is append-only for application roles and is readable through an owner/system-admin-scoped RPC.
- Sensitive customer names, phone numbers, delivery addresses, and statutory discount ID numbers are not copied into the journal snapshots.
- Added an **Activity Journal** tab and spreadsheet export in Business Reports. The UI explicitly describes the journal as technical audit evidence, not a BIR-approved e-Journal.

### Menu tax classification and tax-report completeness

- Added nullable `products.tax_category` choices for `standard_rate`, `vat_exempt`, and `zero_rated`. Existing menu products remain NULL/unclassified; the migration does not guess their treatment.
- Added `order_items.tax_category_snapshot`; a database trigger captures the product's classification when a new order line is created. Later product edits do not rewrite historical order lines.
- Added an owner-authorized RPC to set a product category and a visible classification field/status in Menu Management.
- Added `orders.tax_zero_rated_sales` as nullable: NULL means unknown/not calculated, not a zero amount. Sales reporting now receives zero-rated provenance and whether every line has a tax-category snapshot.
- Tax reports flag a snapshot as incomplete if the zero-rated amount is unknown or any line is unclassified. The report shows product classification counts and the first 25 unclassified menu items, and exports zero-rated fields as blank while unresolved.
- Added supporting exports for recorded Senior Citizen/PWD discount amounts and cancelled/refunded transactions. They are explicitly labelled reconciliation aids, not the prescribed official BIR discount books or Void Report; the required approved format and certain identity/event fields are still missing.
- The current formula is deliberately gated: only VAT-registered orders with all standard-rated line items can be marked calculated under version 1. VAT-exempt/zero-rated item handling, non-VAT tax reporting, and other treatments remain marked for review until accountant-approved truth tables and regression tests are implemented.

### Gated invoice-issuance ledger (storage only; official issue flow disabled)

- Added per-tenant/branch/document-type issuance-control rows with an explicit enabled flag and next-serial cursor. No series row is created by the migration, and there is no default serial such as `1` that could collide with a tenant's pre-existing authorized series.
- Added an immutable issued-document snapshot store with independent serial fields, a minimum six-digit display label constraint, seller/buyer/line-item/financial snapshots, and uniqueness constraints preventing duplicate serials or duplicate invoice types for a single order.
- Added an append-only event store for future reprints, voids, refund links, and credit/debit adjustments.
- Direct `anon`, `authenticated`, and `service_role` table grants are revoked. There is deliberately **no issuance RPC**, no enabled configuration row, and no code path that creates an official invoice from this migration.
- This is storage groundwork only. A future approved path must verify the route/permit, use an authorized starting serial for each branch and document series, atomically allocate serials, snapshot the approved invoice fields, and implement the applicable void/reprint/adjustment/report/transmission requirements before enabling issuance.

### Tenant taxpayer profile and System Admin review workflow

- Added a restricted `restaurant_taxpayer_profiles` table with registered legal name, trade name, TIN, registered address, branch code where applicable, taxpayer category, profile/review status, route choice, and fields for checked accreditation/PTU/Permit to Transmit references.
- The table has RLS enabled and direct table grants revoked from `anon` and `authenticated`. Owner/System Admin access uses explicit authorization-checked RPCs.
- Added Store Settings → Tax & receipts form for the owner to save a draft or submit the profile for platform review.
- Added a System Admin review panel to the restaurant’s Settings page with a profile-status workflow, regulatory-route selector, permit/accreditation reference fields, approved software version, and review note.
- The status “Reviewed” means platform review only. It does not itself certify or authorize BIR invoice issuance; actual route-specific proof must be verified from official documents.
- These fields capture prerequisite evidence; the platform does not yet issue an official invoice from this profile.

### Daily sales reading previews (internal-only; not official BIR readings)

- Added `public.pos_sales_reading_previews` and owner/System Admin-scoped RPCs to generate and list X-style current previews and Z-style day-close previews for a selected Manila business date.
- Previews preserve immutable history and show all/completed/cancelled/paid/pending/refunded counts, completed order totals, recorded discounts and delivery fees, cumulative completed order totals through the date, and tax completeness diagnostics.
- VATable, VAT, VAT-exempt and zero-rated totals are left NULL/incomplete if the existing tax snapshot checks fail or any completed order line has no tax-category snapshot.
- Added Business Reports → **Daily Readings** with a Manila-date selector, X-style preview generation, Z-style day-close preview generation, historical snapshots and spreadsheet export.
- The UI and database explicitly force `is_official = false`. Generating a Z-style preview does **not** close/lock the business day and is not represented as a BIR Z-Reading. The prescribed reading/report format and route-specific end-of-day lock still need to be implemented after regulatory route confirmation.

### Privileged write access hardening

- Added `public.is_system_admin_manager()`, requiring a valid System Admin JWT role, AAL2 MFA, active System Admin access, active status, and owner/administrator access level.
- Restricted taxpayer profile review, disabled invoice series configuration, and online-payment master changes to this helper. The online-payment trigger also uses it, preventing a `view_only` admin from bypassing the UI and changing the master switch through an alternate RPC.
- Tested the role boundary in a rollback-only SQL transaction: manager access worked; view-only access was denied for serial configuration, taxpayer review, and online payment changes. The enabled-series state remained false and all test rows were rolled back.

### Database rollout and smoke test

- The additive migration `20261023153000_bir_pos_journal_and_tax_status.sql` was applied to the Restaurant Ordering Platform Supabase project and the isolated Security Test project.
- The follow-up migrations `20261023160000_journal_pos_discount_beneficiary_changes.sql`, `20261023170000_restaurant_taxpayer_profile.sql`, `20261023180000_bir_invoice_issuance_ledger.sql`, `20261023183000_pos_journal_actor_context.sql`, `20261023190000_bir_issuance_readiness_status.sql`, `20261023200000_product_tax_classification.sql`, `20261023203000_tax_classification_in_sales_reports.sql`, `20261023210000_bir_ledger_read_policies.sql`, `20261023220000_gate_tax_snapshot_completeness.sql`, `20261023223000_bir_readiness_tax_gap_counts.sql`, `20261023230000_configure_disabled_invoice_series.sql`, `20261023233000_validate_invoice_serial_series.sql`, `20261023234000_list_disabled_invoice_series.sql`, `20261023240000_pos_sales_reading_previews.sql`, and `20261023241000_restrict_admin_fiscal_writes.sql` were applied to both connected projects. The invoice-issuance config has zero rows and zero enabled series; no invoices are created by the new code.
- Explicit owner/System Admin SELECT policies were added for sensitive taxpayer profiles and issued-document storage as defense in depth; direct table grants remain revoked.
- Rollback-only tests passed for journal event creation and actor context, immutable invoice-ledger rows, duplicate serial rejection, and product tax-category snapshotting. Test rows were rolled back.
- The readiness RPC returns current blockers for the connected Web2Table restaurant: missing taxpayer profile, no configured serial series, and official invoice issuance disabled.
- Build/deployment workflows passed for the prior platform commit `4d904ed`; the most recent report-export changes are currently building. Check the linked GitHub Actions runs before release acceptance.
- The follow-up `20261023160000_journal_pos_discount_beneficiary_changes.sql` was applied to both projects.
- Schema checks confirmed the status columns, trigger names, and owner/admin-scoped journal RPCs exist in both connected projects.
- A test transaction in the isolated Security Test project produced `SALE_CREATED` and `ORDER_ITEM_ADDED` journal events; the transaction was rolled back and no test order was retained.
- GitHub Actions for the UI/schema work passed at commit `181fa23`: build, deployment, and the Pull Request Build Check. Verify the live deployment and app-to-database paths during release acceptance.

## Important open gaps — this work does not close them

1. **Regulatory route is not yet confirmed.** Obtain written guidance from BIR and a Philippine tax professional on whether Web2Table should pursue Sales Machine/Software supplier accreditation and tenant PTUs, ESP accreditation, both, or another approved route. Do not implement BIR transmission against an assumed API/schema.
2. **No authorized invoice issuance ledger or running invoice serial has been enabled.** The existing `ORD-` order number remains an order identifier; it must not be relabelled as an invoice number. RMO No. 24-2023 specifies a minimum six-digit running serial for the applicable Sales Machine/Software route. The approved serial policy and tenant/branch allocation must be established before issuance is turned on.
3. **Taxpayer-profile capture/review is now present, but route evidence remains unverified.** The owner form and System Admin review panel exist. Details must still be checked against official registration records, and no profile state itself represents BIR approval.
4. **Tax calculation is not yet tax-professional-approved across every channel.** Online payment finalization still needs a single approved calculation/finalization path. Statutory discounts, loyalty/promotional discounts, VAT-inclusive/exclusive prices, VAT-exempt and zero-rated cases, delivery fee treatment, rounding, refunds and adjustments require agreed truth tables and regression fixtures before tax snapshots can be called authoritative.
5. **The statutory invoice template is not implemented.** Current POS printouts remain operational receipts. Required seller/buyer information, exact labels/fields, conditional creditable-withholding-tax data, reprint handling and required statements must be mapped to the current applicable issuance and approved route.
6. **Required readings and backend reports are not implemented as approved fiscal artifacts.** RMO No. 24-2023 describes X/Z or equivalent readings for applicable routes, including sales/discount/refund/return/cancel/void detail and accumulated grand totals. It also describes backend summaries separating VATable, VAT-exempt and zero-rated sales and other reports. The subscription-software exception for e-Journal/X-Z applies only under its stated condition that the system transmits sales data to the BIR; do not assume it applies here.
7. **No formal accreditation or approval has been obtained.** Code changes, database structures, build success, or an internal audit trail do not constitute BIR certification, accreditation, a permit to use, or tax/legal advice.

## Regulatory references to pin before the next production phase

- BIR RMO No. 24-2023 (official full text): https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf
- BIR 2026 Revenue Memorandum Circulars (includes RMC No. 98-2026 dated 22 September 2026; obtain its full text and technical annexes): https://www.bir.gov.ph/2026-Revenue-Memorandum-Circulars
- BIR Electronic Invoicing System portal/advisories: https://eis.bir.gov.ph/
- BIR ESP certification portal: https://eis-cert.bir.gov.ph/
- BIR homepage/current advisories: https://www.bir.gov.ph/

The BIR homepage has advertised an ESP application window from 16–30 October 2026. Because this is time-sensitive and eligibility/required attachments must be verified, contact the issuing BIR office immediately if ESP is a possible intended route. Do not treat a window announcement as evidence that Web2Table qualifies or is accredited.

## Next engineering gates

1. Obtain the signed-off regulatory route and clause-by-clause requirements matrix.
2. Build/verify taxpayer profile and document-serial model for the selected route, but keep actual official invoice issuance disabled until the prerequisite approval/permit state is verified.
3. Unify POS cash and online payment finalization so each sale persists one versioned, approved tax/discount snapshot atomically or has a recoverable failure state.
4. Implement issued-document immutability, void/refund/adjustment links, safe reprint semantics, required backend reports and readings for the selected route.
5. Add tests for authorization, cross-tenant access, concurrent serial allocation, failed/retried payments, discount/tax combinations, void/refund flow, daily close lockout and export reconciliation.
6. Complete accountant review, BIR submission/demonstration, required permits/approvals and release acceptance before describing the product as BIR-accredited.

**Release statement:** Web2Table has new fiscal-audit groundwork and tax snapshot provenance, but is not yet ready to be represented as BIR-accredited.