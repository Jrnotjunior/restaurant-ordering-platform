# Web2Table POS — BIR Readiness Initial Gap Audit

**Status:** Initial repository review; not a certification or legal/tax opinion  
**Reviewed:** 2026-10-20  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Scope:** Multi-tenant restaurant POS, sales records, receipts, tax settings, reporting, and controls

## Executive summary

Web2Table already has useful foundations: server-side POS tax/discount calculations, tax snapshots stored with orders, cashier payment confirmation, restaurant-specific sequential **order** numbers, receipt printing, and tax-support exports.

However, the reviewed implementation does **not yet demonstrate** that Web2Table satisfies the BIR's complete sales-machine/software accreditation requirements. The existing order number must not be treated as a BIR invoice serial without verifying the required registration/authorization and numbering rules. The business reports UI explicitly labels its exports as supporting records, not official invoices or tax returns. We should not represent the platform or generated receipts as BIR-accredited/compliant until requirements have been confirmed, implemented, tested, and the relevant approvals obtained.

This is a gap-finding document, not a statement that every item below is absent. Some capabilities may exist elsewhere in the repository or live database and require further inspection.

## Regulatory baseline to validate

Use the latest applicable versions and confirm interpretation with the BIR/RDO or a Philippine tax professional before production implementation:

1. **BIR RMO No. 24-2023** — accreditation policies for CRMs/POS and other sales machines/software generating invoices/receipts, including subscription-based systems. Its annexes cover standard invoice/receipt formats, X-Reading, Z-Reading, backend reports, and audit/electronic journals.
   - Official issuance: https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf
   - BIR issuance index and annexes: https://www.bir.gov.ph/2023-Revenue-Memorandum-Order
2. **RR No. 7-2024, as amended by RR No. 11-2024**, and **RMC No. 77-2024** — invoicing requirements following the Ease of Paying Taxes Act. Validate the invoice type and fields for each taxpayer profile; do not reuse a generic receipt layout for every tenant.
   - Official RMC: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf
3. **RMC No. 72-2025** — BIR clarification about accreditation certificates affected by prior expiration dates; confirm any subsequent issuances and the applicable process for a new applicant.
   - BIR website / Revenue Issuances: https://www.bir.gov.ph/
4. Confirm whether the product's exact intended model (multi-tenant SaaS POS that generates sales invoices/receipts) requires supplier/software accreditation, any Authority to Generate or other approval for electronic invoices, and the separate registration/permit steps for each taxpayer deployment. Do not assume the rules for an ordering-only tool apply to an invoice-generating POS.

## Evidence observed in the repository

### Existing foundations

- `supabase/migrations/0034_restaurant_tax_settings.sql` adds restaurant VAT configuration and stores tax/discount financial snapshots on `orders`; the migration describes financials as server-calculated and historical snapshots as preserved.
- `src/modules/pos/posRepository.ts` reads VAT settings through `get_restaurant_tax_settings`, confirms cash payment through `confirm_dine_in_payment`, and calls the server-side discount-finalization RPC.
- `src/pages/RestaurantCashierPosPage.tsx` contains cashier POS flows and a printable receipt/kitchen-order area. The stylesheet formats POS print output at 80mm.
- `supabase/migrations/20261004205114_restaurant_specific_sequential_order_numbers.sql` introduces per-restaurant sequential **order** numbers. A later migration updates delivery order creation to use that generator.
- `src/pages/RestaurantBusinessReportsPage.tsx` exports tax-support sales data and explicitly states that these exports are not official BIR invoices, books, returns, or confirmation of tax compliance.

### Gaps or risks requiring verification

1. **Taxpayer identity and registration profile — HIGH**
   - Verify storage and controlled maintenance of registered legal name, trade name where applicable, TIN, registered address, branch code, VAT/non-VAT tax treatment, and the applicable invoice/permit/accreditation details.
   - The reviewed tax settings migration stores VAT status, price-inclusivity and rate, but does not add these invoice identity/registration fields.
   - Each tenant/branch must use its own verified taxpayer identity and configuration. A Web2Table platform identity must not be substituted for the seller taxpayer.

2. **Invoice issuance and serial-number controls — HIGH**
   - Separate order identifiers from invoice serial numbers.
   - Confirm approved invoice type, required fields, serial/series rules, registration/authorization references, reprint/copy labeling, and controlled sequence allocation.
   - Confirm behavior under concurrent sales, retries, cancelled drafts, failed printing, refunds and voids. Never silently reuse an issued invoice number or delete a completed sale.

3. **X-Reading, Z-Reading and accumulated totals — HIGH**
   - No evidence found in the inspected files that the complete required reading formats, reset/report counters, grand-total continuity, or cashier/terminal/session close controls are implemented.
   - Inspect the full repository and deployed schema before marking these as missing. Design reset/close semantics only against the official specifications.

4. **Audit journal / electronic journal — HIGH**
   - Confirm immutable or tamper-evident capture of each sale, invoice issuance, void, refund, discount, reprint, cashier action, date/time, and administrative change.
   - Existing system-admin audit logs are not by themselves proof that the POS transaction journal requirements are met.

5. **Backend reports and sales reconciliation — HIGH**
   - Tax-support spreadsheets are not equivalent to BIR-prescribed backend reports.
   - Map required fields and totals to the official report annexes; reconcile invoices, completed/voided/refunded sales, cash and non-cash tender, VATable/VAT-exempt/zero-rated amounts where applicable, discounts, and daily totals.
   - Verify the distinction between gross sales, discounts, VAT, net sales, delivery fees, payment processor fees, and amounts received.

6. **Tax/discount calculation and source evidence — HIGH**
   - Existing server-side tax snapshots are a useful start, but the formulas and eligibility handling need review against the taxpayer's actual tax classification and applicable rules, especially senior citizen/PWD discounts, VAT-exempt sales, and mixed transactions.
   - Never infer a tax rate or treat missing configuration as zero-tax compliance. Fail closed or require a verified configuration for invoice issuance.

7. **Tenant/branch isolation and roles — HIGH**
   - Test owner, cashier, platform administrator and branch scenarios. A tenant must not read, edit, issue against, or export another tenant's taxpayer identity, invoice sequence, sales totals, journal or reports.
   - Review every relevant RPC's authorization and grants, including `SECURITY DEFINER` functions.

8. **Data retention, backup, recovery and offline behavior — HIGH**
   - Determine official retention requirements and implement tested backup/restore, integrity checks, access controls, and export/recovery procedures.
   - Define how the POS behaves when connectivity fails; do not issue duplicate numbers or lose locally accepted transactions during retries.

9. **Evidence and accreditation package — HIGH**
   - Prepare the system description, software/version identity, deployment architecture, sample outputs, technical documentation, test cases/results, user/operator procedures, and documents required by the current eAccReg/accreditation process.
   - Verify the current checklist and responsible BIR office before submitting.

## Recommended implementation sequence

### Phase 0 — Confirm the rules and scope (before schema changes)
- Obtain and review the complete RMO 24-2023 text and all applicable annexes, the current invoice rules, and later amendments/clarifications.
- Confirm in writing with the relevant BIR office/professional whether Web2Table should apply as a POS software supplier/developer, the exact application route, and which approvals are required for SaaS electronic invoicing/receipting.
- Decide whether the first target is printed invoices, electronic invoices, or both; do not assume approval for one automatically covers the other.

### Phase 1 — Complete code/schema audit
- Inspect current production schema/functions and all receipt/report paths.
- Create a requirement-by-requirement matrix with source clause, existing implementation, gap, test evidence, owner and status.
- Verify all current migrations are applied in the intended environment; do not run a production migration as part of this audit.

### Phase 2 — Build compliance foundations
- Add taxpayer/branch registration profiles and controlled verification state.
- Design separate invoice sequencing and issuance records, append-only journal events, controlled void/refund/reprint workflows, and safe daily close/readings.
- Define a versioned tax engine with tested examples and immutable transaction snapshots.

### Phase 3 — Outputs, security and tests
- Implement approved invoice templates and prescribed readings/reports only after the format requirements are confirmed.
- Add tenant-isolation, authorization, concurrency, retry/idempotency, tamper-resistance, retention, backup/restore and reconciliation tests.
- Generate a test evidence pack for review.

### Phase 4 — External validation and application
- Have a Philippine tax professional review tax/invoice logic.
- Conduct a pre-application consultation with the appropriate BIR office.
- Submit the current required supplier/software accreditation application and separately guide each tenant through its taxpayer-specific registration/permit process.
- Do not claim accreditation until formally granted.

## Acceptance criteria before any BIR-compliance claim

- Current applicable requirements are mapped to code and tests.
- The invoice type and all required fields are validated for each tenant.
- Invoice numbers are separate from order IDs, sequential under concurrency, and never silently reused after issuance.
- Sale, void, refund, discount, reprint and cashier actions have auditable histories.
- Required readings, grand totals, journals and backend reports match the official formats and reconcile to transaction-level records.
- Tenant/branch isolation tests pass.
- Backup, recovery and retention procedures are documented and tested.
- External tax review and BIR approval/registration steps are completed as applicable.

## Guardrails

- Do not label current receipts “BIR-accredited,” “official BIR invoice,” or compliant before the required approval and taxpayer-specific registration/authorization are confirmed.
- Do not treat an `ORD-...` order number as an authorized invoice serial by assumption.
- Do not deploy speculative tax calculations or production schema changes before the requirement matrix and migration/test plan are reviewed.
- Treat this report as a living audit. Update it with code paths, test evidence, official clause references, and reviewer sign-off as each item is closed.
