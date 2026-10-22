# Web2Table POS — Code and Live-Schema Audit Findings

**Audit date:** 2026-10-20  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`, branch `main`  
**Database inspection:** Read-only catalogue, permissions, routine-definition and aggregate queries against the connected Supabase project  
**Scope:** POS order/payment/discount lifecycle, sales exports, tenant-level database protections, and initial BIR readiness evidence  
**Status:** Findings for remediation planning. Not a certification, legal opinion, tax opinion, penetration test, or statement that the connected database is production.

## Executive summary

The inspected system already has useful foundations: tax settings are tenant-scoped; POS tax snapshots are calculated in a server-side routine; the main cashier/payment routines check restaurant ownership or active cashier status; order IDs have a separate `ORD-`-style per-restaurant sequence; and row-level policies scope normal order access by tenant.

Those controls do **not** make the current product ready to be represented as an official BIR invoice/POS system. Three issues deserve priority before further feature work:

1. **Financial integrity:** the connected database grants `authenticated` UPDATE privilege on the `orders` table and the active row policies permit tenant owners to update their restaurant's orders. Column-level checks confirmed that authenticated users have SQL privileges to update `total`, `tax_vat_amount`, `payment_status`, and `order_number`. This is a broad write path for fields that must eventually be protected once a document is issued. Row-level security is useful tenant isolation; it is not a substitute for column-level restrictions or an immutable issued-document ledger.
2. **Tax data coverage and consistency:** server-calculated POS tax snapshots are written by `apply_pos_group_discounts`, but the online-payment finalizer inserts paid orders without assigning the tax snapshot fields, which therefore keep their zero defaults. The connected project’s aggregate snapshot at the time of this audit was: 62 orders, 46 marked paid, 60 positive-total orders with all checked tax snapshot fields at zero, 44 such orders marked paid, and 2 positive-total orders with a positive `tax_gross_sales`. These counts do not establish whether records are legacy, test, or live business transactions; they are a reconciliation flag, not a basis for automatic backfill.
3. **No separate BIR invoice issuance evidence:** reviewed live public schema objects and relevant function names did not show a dedicated invoice-issuance ledger/serial, BIR transmission queue/acknowledgement, sales journal, daily close/readings data model, or taxpayer TIN/legal-registration fields. The customer POS printout reviewed uses an `ORD-` order number, does not draw registered seller identity from a tax profile, and is labelled “CUSTOMER RECEIPT.” Treat it as an operational receipt, not an official BIR invoice.

A separate reporting inconsistency was also identified: loyalty redemption increases `orders.discount_amount` and reduces `orders.total`, while `get_restaurant_sales` returns that discount field **and** a derived `loyalty_discount_amount`; the sales/tax support exports add both fields. This can double-count loyalty discounts in the exported discount figure. The loyalty redemption routine does not recalculate the tax snapshots written earlier by the POS discount routine, so the tax basis may also cease to agree with the final amount. This needs a tax-approved accounting rule before implementation.

## Evidence and limitations

The audit used GitHub source inspection and read-only queries against live PostgreSQL catalogue metadata, routine definitions, grants, RLS policies, triggers, and aggregate order/tax-snapshot counts. No customer names, IDs, order details, or transaction-level records are included in this report.

The database environment (production versus staging/demo) was **not independently established** by the audit query. The aggregate figures are a snapshot of the connected project at audit time and may change. The absence of an object name in a targeted query is not, by itself, proof that no equivalent exists anywhere else; findings are limited to the objects and source paths reviewed.

No application files, database schemas, data rows, secrets, or deployments were changed as part of this audit.

## Findings by priority

### P0 — Broad direct UPDATE rights can alter financial and identity fields

**Evidence**
- `public.orders` has RLS enabled.
- The owner update policy scopes rows to the authenticated owner of the restaurant, and the current dispatcher policy also grants scoped row updates.
- `information_schema.role_table_grants` reports table UPDATE privilege for `authenticated` on `public.orders`.
- Column privilege checks returned true for `authenticated` on `orders.total`, `orders.tax_vat_amount`, `orders.payment_status`, and `orders.order_number`.
- The inspected `orders` triggers include status/inventory/loyalty/realtime/default-branch logic, but no general trigger or append-only journal that records and protects every change to issued sale/financial fields.

**Impact**
Tenant isolation can still be working while a permitted owner can edit an order’s total, tax amount, payment state, or order number. This undermines auditability and future invoice serial integrity. It is not evidence that an attacker has done so.

**Safe correction approach**
- Inventory every direct table write in the frontend and backend first (dispatch assignment/completion and any other legitimate update paths).
- Replace broad direct updates with narrow server-side RPCs for explicitly permitted workflow fields.
- Restrict changes to protected financial/serial/payment fields after the relevant issuance/finalization point; do not break legitimate dispatch/order status flows.
- Add negative tests proving tenant A, tenant B, each staff role, and ordinary customers cannot alter protected financial/issuance fields.
- Add a server-side event history for changes, and an immutable/append-only record for issued documents. Do not claim this is solved by the existing system-admin audit log.

**Do not run a blanket revoke as a quick fix:** it could break valid dispatch flows and live operations. Map the direct writes first.

### P0 — Paid online orders do not receive the reviewed POS tax snapshots

**Evidence**
- `supabase/migrations/0034_restaurant_tax_settings.sql` adds restaurant VAT flags and zero-default tax snapshot fields to `orders`.
- The cashier flow calls `apply_pos_group_discounts`, which writes those tax snapshot fields.
- The connected `public.finalize_online_payment(...)` routine inserts an order without specifying `tax_vat_registered`, `tax_prices_vat_inclusive`, `tax_vat_rate`, `tax_gross_sales`, `tax_vatable_sales`, `tax_vat_amount`, `tax_vat_exempt_sales`, or `tax_net_sales`.
- The sales repository maps absent/zero snapshot values into numeric values, so a tax report may show zeros rather than indicating the snapshot was never computed.
- The read-only aggregate count in the executive summary flags records needing reconciliation.

**Impact**
The tax-support sales report can omit tax data for online transactions, and the dataset does not currently tell a report consumer whether a zero tax field means a valid zero or an uncomputed snapshot.

**Safe correction approach**
- Design one server-side sales calculation/finalization service used by all sale channels, with an explicit calculation version and result status.
- Distinguish “not computed/legacy” from a computed zero; do not infer the historical value from today’s restaurant settings.
- Reconcile historical orders using source records and human/accountant review before any backfill. No automatic update of existing records in this phase.
- Add fixtures covering VAT/non-VAT, inclusive/exclusive prices, statutory discounts, loyalty discounts, delivery fees, online payment, rounding, cancellation/refund, retries and mixed baskets.

### P1 — Loyalty discounts can be double-counted in exports and leave tax snapshots stale

**Evidence**
- `public.redeem_loyalty_reward` adds the loyalty amount into `orders.discount_amount` and reduces `orders.total`.
- `public.get_restaurant_sales` returns `o.discount_amount` and independently derives `loyalty_discount_amount` from loyalty redemption transactions.
- `src/pages/RestaurantBusinessReportsPage.tsx` adds `discountAmount + loyaltyDiscountAmount` to produce exported discount totals.
- The redemption routine updates order discount and total but does not update the `tax_*` snapshots originally saved by the POS discount routine.

**Impact**
Exported discount amount may double-count loyalty redemption. Tax totals may describe the pre-loyalty state while the order total represents the post-loyalty state.

**Safe correction approach**
- Decide (with tax/accounting review) the tax treatment and exact ledger representation of each discount type.
- Separate statutory discounts, promotional/loyalty discounts and other adjustments as distinct fields/events; do not overload one field and then add it to a derived duplicate.
- Recalculate the finalized financial snapshot atomically in a single transaction and write tests showing report totals reconcile to order totals.

### P1 — Cashier POS is a multi-call workflow, not an atomic finalization

**Evidence**
`src/pages/RestaurantCashierPosPage.tsx` sequences calls to create the order, optionally attach customer, apply POS group discounts, optionally redeem loyalty points, and confirm cash payment. Receipt data is then composed in the browser and printed. These operations are separate calls.

**Impact**
If an intermediate call fails, an order can remain created but not paid/finalized or could be retried as a new order. This does not prove duplicate sales have occurred, but the flow has no single transaction boundary across the sequence.

**Safe correction approach**
- Create an idempotent POS finalization API/RPC that validates all inputs and records a sale atomically (or explicitly manages a recoverable draft/failure state).
- Do not move payment/loyalty state changes into an untrusted browser-only calculation.
- Add safe retry semantics and tests for failure after every stage. Keep print/reprint out of sale issuance logic.

### P1 — Receipt rendering is operational, not a BIR invoice implementation

**Evidence**
`src/pages/RestaurantCashierPosPage.tsx` renders a “CUSTOMER RECEIPT” with an `ORD-` number, client-generated print timestamp, buyer/customer label, order items, totals, some VAT labels, discounts, cash received and change. It does not source the registered seller’s full invoice identity and an authorized document serial from a distinct taxpayer/invoice record. The relevant inspected schema has no public TIN, invoice serial, document issue ledger, zero-rated sales, or BIR approval/permit fields.

**Impact**
There is no evidence in the inspected implementation that this printout fulfils the current registered-invoice form or serial requirements. It must not be presented as BIR-accredited or as proof of an official invoice.

**Safe correction approach**
- Establish the correct BIR software/accreditation/e-invoice route before designing the final document.
- Add a tenant/branch taxpayer profile with controlled verification for registered name, TIN, registered address, applicable branch code/registration, taxpayer category and applicable document type.
- Implement a separate invoice document/issuance ledger and collision-safe authorized serial allocator. Keep the order number separate.
- Generate the invoice from persisted server-side issue data, not the editable client cart or a client-side timestamp.
- Define reprint, void, refund and adjustment semantics, and protect issued records.

### P1 — VAT/non-VAT classification needs accountant-reviewed correction and tests

**Evidence**
The POS browser calculation and `apply_pos_group_discounts` calculate `vatable_sales` from the remaining base sale amount regardless of whether the restaurant is VAT-registered; only the VAT amount is zeroed for non-VAT tenants. The receipt labels that amount “VATable sales.” Current rules and tenant-specific circumstances must govern the correct fields and labels.

**Impact**
A non-VAT restaurant could see sales classified and printed as “VATable sales” even though its setting says it is not VAT-registered. The exact corrective formula/format must not be guessed.

**Safe correction approach**
Get written expected outcomes from a Philippine tax professional for VAT-registered, non-VAT, VAT-inclusive, VAT-exclusive, exempt and zero-rated scenarios, plus each statutory discount. Encode those expected outcomes in shared server-side calculation tests before changing the business logic.

### P1 — Statutory discount ID validation is stronger in the UI than in the RPC

**Evidence**
`apply_pos_group_discounts` checks the beneficiary type is senior/PWD and requires non-empty ID type and ID number. The reviewed RPC does not validate the ID-type allowlist against the discount type, while the UI uses separate ID choices per discount type.

**Impact**
A caller bypassing the browser could submit an arbitrary non-empty ID type for a beneficiary. This is a backend input-validation gap, not a conclusion that a particular claim was fraudulent.

**Safe correction approach**
Implement one reviewed server-side allowlist for accepted ID categories and their relationship to beneficiary type, plus duplicate-person/group rules where required. Minimize retention/exposure of sensitive ID data and verify current lawful documentation requirements with counsel/accountant.

### P1 — Tax/report model does not show zero-rated sales or “not calculated” state

**Evidence**
The inspected tax snapshot columns include VATable sales, VAT amount, VAT-exempt sales and net sales, but no zero-rated sales field or tax calculation status/version. Tax columns default to zero. Targeted searches for invoice/journal/reading/permit/BIR routines and relevant public table names did not find corresponding objects in the inspected project.

**Impact**
Reports cannot reliably distinguish an intentionally zero amount from a calculation that never ran, and the reviewed schema does not represent all relevant sales classifications.

**Safe correction approach**
Model tax classifications and completeness according to verified BIR rules; represent uncomputed/legacy/error distinctly from computed zero. Do not add a zero-rated field by itself without aligning invoice format, accounting model and report totals.

### P2 — Existing audit table does not establish a POS transaction journal

**Evidence**
`public.system_admin_audit_logs` records system administrator actions and has administrator-oriented read policies. Inspected triggers on `orders` are primarily operational (inventory, delivery, loyalty, store hours, realtime and timestamps); no generic journal trigger was found for invoice/payment/discount/void/reprint changes. This is not an exhaustive proof of every external logger.

**Impact**
There is no evidence in the inspected database objects of a complete per-sale event journal that records cashier identity, issuance, tax outcome, payment, adjustments, refunds, voids and reprints.

**Safe correction approach**
Choose the required journal/reporting/transmission architecture only after confirming the applicable BIR path. Journal events should be tenant-scoped, append-only for application roles, linked to issued documents, and reconcilable to payment and accounting totals.

## Current regulatory decision gate

The BIR's RMO No. 24-2023 describes particular requirements for registered/accredited Sales Machines/Software and a conditional exception for subscription-based e-invoicing/e-receipting systems that **transmit sales data to the BIR**. That condition cannot be assumed for Web2Table simply because it is hosted SaaS. The same issuance describes invoice serial requirements and backend reports for relevant machine/software accreditation.

Current official starting points to obtain and pin in the requirements package:
- RMO No. 24-2023: https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf
- RR No. 7-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024%20%28final%29.pdf
- RMC No. 77-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf
- BIR 2026 Revenue Regulations: https://www.bir.gov.ph/2026-Revenue-Regulations
- BIR 2026 Revenue Memorandum Circulars: https://www.bir.gov.ph/2026-Revenue-Memorandum-Circulars
- BIR EIS / e-Invoice Certification: https://eis.bir.gov.ph/ and https://eis-cert.bir.gov.ph/

The 2026 BIR index lists RR No. 6-2026 (mandatory invoice information, including creditable withholding tax information) and RMC No. 98-2026 (electronic-invoice policies/guidelines). The BIR site has also announced an ESP application window of October 16–30, 2026. This is time-sensitive and should be checked directly with the current BIR portal/issuing office before selecting Web2Table's route. The applicable software/accreditation route and tenant-level taxpayer obligations may not be the same thing.

**Decision required before production implementation:** ask BIR and a Philippine tax professional to confirm in writing whether Web2Table will act as (a) software supplier seeking POS/CRM accreditation for tenant use, (b) Electronic Invoicing Service Provider or middleware provider, (c) both, or (d) a platform that leaves invoice issuance to a separately approved tenant system; and determine the required data transmission, authorization/permit, versions and tenant/branch registration process.

## Recommended implementation order

1. **Confirm regulatory product route and tenant eligibility.** Pin the exact current BIR issuance versions and clause references. Confirm which tenants are required to use electronic invoices and the exact permit/accreditation/middleware route.
2. **Write financial truth tables first.** With accountant-approved expected results, specify each tax, discount, fee, refund, void, and adjustment calculation. Make all channels use the same server-side source of truth.
3. **Harden order mutation boundaries.** Inventory legitimate direct updates, move them to narrow RPCs, constrain finalized fields, add a per-sale event history and negative security tests.
4. **Design invoice issuance separately from orders.** Add tenant/branch registration profile, invoice issuance ledger and serial allocator only after official formats/serial rules are pinned. Build immutable issue/reprint/void/adjustment handling.
5. **Unify finalization and idempotency.** Implement atomic or recoverable state transitions across POS cash and online payments. Preserve historical records; do not synthesize an invoice for a legacy order unless reviewed and legally approved.
6. **Make the reports reconcile.** Test sales, payment-provider settlements, discounts, tax totals and adjustments against the same persisted ledger; flag uncomputed legacy fields instead of turning them into zeros.
7. **Run release acceptance tests and external review.** Include cross-tenant negative tests, concurrent issuance, RPC authorization, retry failures, backup/restore, retention, printer/reprint behavior and clause-linked BIR demo scripts.

## Explicitly not done in this audit

- No tax calculation has been changed.
- No invoice number has been issued or backfilled.
- No existing orders or tax snapshot values have been altered.
- No database migration has been applied.
- No application code or deployment has been changed.
- No BIR certification/accreditation is claimed.

This document is a technical audit aid. It requires review by the product owner, a Philippine tax professional, and the relevant BIR office before being used as a compliance determination.
