# Web2Table POS — BIR Readiness Implementation Status

**Updated:** 2026-10-23  
**Repository:** `Jrnotjunior/restaurant-ordering-platform` (`main`)  
**Status:** Technical groundwork in progress. **Not BIR-accredited, not a BIR-issued invoice implementation, and not approval to represent this system as compliant.**

## Work completed in this phase

### Tax snapshot provenance

- Added `orders.tax_snapshot_status` and `orders.tax_snapshot_version`.
- Existing orders are marked `legacy_unknown`; no historical amounts, tax rates, or invoices were inferred or backfilled.
- New orders default to `not_calculated` until a server-side routine records a calculation.
- The existing POS tax-finalization routine marks its saved result `calculated` with calculation version 1.
- If a later financial update changes subtotal, delivery fee, discount or order total without recalculating the tax snapshot, the status becomes `requires_review`.
- Tax-support reports now leave tax amounts blank and identify missing/legacy/review-required calculations rather than presenting schema-default zeroes as calculated tax.

### Append-only technical activity journal

- Added `public.pos_sales_journal` with timestamp, database transaction ID, restaurant/order references, event and operation types, actor context, and before/after financial snapshots.
- Added triggers for order, order-item, and statutory discount beneficiary changes.
- The journal is append-only for application roles and is readable through an owner/system-admin-scoped RPC.
- Sensitive customer names, phone numbers, delivery addresses, and statutory discount ID numbers are not copied into the journal snapshots.
- Added an **Activity Journal** tab and spreadsheet export in Business Reports. The UI explicitly describes the journal as technical audit evidence, not a BIR-approved e-Journal.

### Tenant taxpayer profile and System Admin review workflow

- Added a restricted `restaurant_taxpayer_profiles` table with registered legal name, trade name, TIN, registered address, branch code where applicable, taxpayer category, profile/review status, route choice, and fields for checked accreditation/PTU/Permit to Transmit references.
- The table has RLS enabled and direct table grants revoked from `anon` and `authenticated`. Owner/System Admin access uses explicit authorization-checked RPCs.
- Added Store Settings → Tax & receipts form for the owner to save a draft or submit the profile for platform review.
- Added a System Admin review panel to the restaurant’s Settings page with a profile-status workflow, regulatory-route selector, permit/accreditation reference fields, approved software version, and review note.
- The status “Reviewed” means platform review only. It does not itself certify or authorize BIR invoice issuance; actual route-specific proof must be verified from official documents.
- These fields capture prerequisite evidence; the platform does not yet issue an official invoice from this profile.

### Database rollout and smoke test

- The additive migration `20261023153000_bir_pos_journal_and_tax_status.sql` was applied to the Restaurant Ordering Platform Supabase project and the isolated Security Test project.
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