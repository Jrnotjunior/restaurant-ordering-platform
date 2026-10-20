# Web2Table — BIR POS / Electronic Invoicing Accreditation Readiness Plan

**Prepared:** 2026-10-21  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Status:** Engineering readiness plan. Not legal/tax advice, not a BIR determination, not a certificate of accreditation, and not authorization to issue official BIR invoices.

## 1. Goal and boundary

Prepare Web2Table so the correct BIR approval route can be demonstrated and evaluated. The software must not be marketed as "BIR-accredited", "BIR-approved", or as issuing official BIR invoices until the relevant approval/permit has actually been granted and its scope and version are verified.

BIR accreditation is an external approval. Code changes alone cannot obtain it. Tenant taxpayers may also have their own registration, Permit to Use (PTU), branch, and implementation obligations. The supplier/tenant distinction must remain explicit in product requirements.

## 2. Regulatory routing gate — do this first

The official BIR index currently lists RMO No. 24-2023 for accreditation of CRMs, POS and other similar sales machines/software generating invoices/receipts, including subscription-based e-invoicing/e-receipting systems. The BIR home page also lists an ESP application window of 16–30 October 2026 and an advisory saying no entity had been officially recognized as an ESP as of 14 September 2026.

These are not interchangeable routes. Before choosing architecture, obtain written confirmation from the relevant BIR office and Philippine tax counsel/accountant whether Web2Table should pursue:
1. supplier/pseudo-supplier accreditation of sales machine/software under the applicable BIR program;
2. Electronic Invoicing Service Provider (ESP) certification/accreditation and related EIS transmission obligations;
3. both routes; or
4. a different approved integration where the tenant uses a separately approved invoicing system.

The ESP application window is time-sensitive. Confirm the current portal, requirements, eligibility, application status, and exact deadline directly with BIR now; this plan is not a substitute for submitting an application.

### Primary official starting points
- BIR RMO No. 24-2023 index and annexes: https://www.bir.gov.ph/2023-Revenue-Memorandum-Order
- RMO No. 24-2023 full text: https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf
- BIR 2026 Revenue Regulations index (includes RR No. 6-2026, issued 1 October 2026, amending mandatory invoice information): https://www.bir.gov.ph/2026-Revenue-Regulations
- BIR 2026 Revenue Memorandum Circular index: https://www.bir.gov.ph/2026-Revenue-Memorandum-Circulars
- BIR eAccReg: https://eaccreg.bir.gov.ph/ACCREG/help.html
- EIS taxpayer portal: https://eis.bir.gov.ph/
- EIS ESP certification portal: https://eis-cert.bir.gov.ph/

**Regulatory uncertainty to resolve:** the official full text, current annexes, technical/API payload specification, effective dates, applicability to each tenant type, and requirements for any 2026 issuances must be obtained and version-pinned before encoding exact rules. Do not design an assumed EIS API from screenshots, an older circular, or secondary summaries.

## 3. Current database/code baseline inspected read-only

Connected Supabase project: `xaihajwrsvcdjisezmmc`, PostgreSQL 17.6. It was treated as sensitive; no write queries, migrations, backfills, or deployments were performed during this audit.

The 20 October code/schema audit and focused follow-up found:
- 45 public tables and RLS enabled on all 45.
- 167 SECURITY DEFINER functions and 37 non-internal triggers; these require a categorized review, not blanket revocation.
- A tenant tax settings model (`tax_vat_registered`, price-inclusive flag, rate) and order tax snapshot columns exist, but there is no inspected dedicated taxpayer/invoice issuance/serial ledger, BIR sales-report close/readings ledger, or invoice transmission/acknowledgement model.
- Cashier POS writes reviewed tax snapshots through `apply_pos_group_discounts`; `finalize_online_payment` creates paid online orders without writing those snapshots, leaving default zeros. The observed aggregate snapshot needs reconciliation; do not use it to backfill historical records automatically.
- The POS print path renders a browser-generated "CUSTOMER RECEIPT" with the `ORD-` order number. This is not proof of an official invoice or approved fiscal serial.
- Loyalty redemption changes order discount and total after the earlier POS snapshot and may leave tax snapshots stale. A previous application fix addressed loyalty discount double counting in reporting, but it did not correct the underlying tax calculation/finalization model.
- Non-VAT classification, discount/loyalty tax treatment, rounding, zero-rated sales, creditable withholding tax information, adjustments and document lifecycle need tax/accountant-approved expected results before implementation.

The absence of a named object in a targeted audit is not proof that no equivalent exists anywhere. Findings are limited to reviewed live schema objects and code paths.

## 4. Readiness gaps and acceptance criteria

### P0 — Stable tax truth across every channel
**Gap:** POS and online-payment paths do not produce a single consistent, versioned server-side tax result.

**Target:**
- One database transaction or recoverable, idempotent finalization workflow for POS cash, online payment and permitted order channels.
- Store calculation version, status (computed / not computed / legacy / error), tax classification totals, discount breakdown, fee treatment, rounding and final payable totals.
- Never interpret “default zero” as “tax correctly calculated as zero.”
- Prevent protected finalized financial data from being directly rewritten by browser roles.
- Preserve original history. Any legacy reconciliation/backfill requires source evidence, accountant review and a separately approved migration; never infer an old tax result from current tenant settings.

**Acceptance evidence:** approved truth-table fixtures for VAT-registered/non-VAT, inclusive/exclusive prices, statutory senior/PWD discounts, loyalty/promotional discounts, delivery fees, online payment, refunds, voids, retries and rounding; cross-channel reconciliation test outputs and reviewed migration plan.

### P0 — Tenant taxpayer and branch profile
**Gap:** reviewed schema does not evidence a dedicated, verification-controlled legal seller profile suitable for the approved invoice format.

**Target after regulatory route is confirmed:** model taxpayer/branch legal name, TIN, registered address, branch details/code, tax category, the approved document type, taxpayer-provided registration artifacts/verification status, and scope/effective dates. Separate supplier details from each restaurant tenant’s seller identity. Restrict who can modify these values; record change history. Collect only fields required by BIR and privacy law.

**Acceptance evidence:** approved field-level mapping to the current BIR checklist, authorization record, tenant-specific validation tests, and no cross-tenant access.

### P0 — Separate official document issuance from order numbering
**Gap:** `ORD-` is an operational order number; it must not be reused or relabelled as a BIR invoice serial without approval.

**Target after approved numbering/document rules are pinned:**
- Dedicated invoice/document ledger and concurrency-safe serial allocator.
- Server-only issuance; every issued document references immutable order and tax snapshot versions.
- Draft vs issued states; clear issue date/time rules; authorized reprint; void, cancellation, credit/debit adjustment, refund and correction events.
- No silent deletion or in-place rewriting of an issued document. Append adjustments/reversal records with actor, time, reason, references and approval where required.
- Serial format, starting serial, counters, reset behavior, per-tenant/branch scope and effective date configurable only according to BIR approval.

**Acceptance evidence:** concurrency tests, no-duplicate-number test, denied direct DML, reprint/void audit tests, recovery/retry tests, and signed-off demonstration scripts.

### P1 — Reports, readings and traceability
**Gap:** the reviewed objects do not demonstrate the full required set of BIR backend reports/readings for the approved route.

**Target only against the approved checklist:** implement each applicable sales summary/tax category, discount, void/refund/return/adjustment report, journal/readings/close controls, accumulated totals/counters and reprint/audit reports. If a particular reading/report is not required because a BIR-authorized transmission exception applies, preserve written evidence of that condition; do not infer a blanket exemption.

**Acceptance evidence:** every required BIR report maps to persisted ledger entries and reconciles to payment/order totals. A close locks the applicable sales operation date according to the rule approved for the product. All required readings are reproducible from persisted records.

### P1 — E-invoice transmission, if required by chosen route
**Target only after current official technical specifications are obtained:**
- Versioned payload contract, schema validation, idempotency key, outbound queue, retry/backoff, failure/dead-letter handling, BIR/ESP response and acknowledgement storage, reconciliation dashboard, controlled credentials, and operational alerts.
- Preserve exact request/response evidence required for audit while minimizing personal data and secrets.
- Clearly model network delivery separately from BIR acceptance; never mark an invoice transmitted/accepted based only on a successful HTTP request.
- Reconcile outstanding/unacknowledged transactions and define a documented outage/degraded-mode procedure approved by BIR/counsel.

**Acceptance evidence:** official-spec test vectors, positive/negative validation cases, duplicate/retry tests, failure recovery, receipt of official acceptance/rejection statuses, and end-to-end demo.

## 5. Safe implementation sequence

1. **Get the route in writing.** Confirm supplier POS software accreditation vs ESP/EIS certification vs both; confirm tenant PTU/registration duties, applicable issuance clauses, formats, numbering, reports, deadlines and official technical interfaces.
2. **Approve tax semantics.** A Philippine tax professional provides expected numeric results and mandatory invoice field mappings; product owner approves them.
3. **Complete the SOC 2-oriented security gate.** Replace broad browser writes with narrow authorized RPCs, append-only invoice lifecycle events, least privilege, tenant-negative tests and reviewed change/deployment controls.
4. **Implement one server-side financial finalization path.** Tax result and payment/document states must be consistent and idempotent for every channel.
5. **Implement taxpayer profile + document ledger + approved serial allocator.**
6. **Implement required reports/readings and any official transmission adapter.**
7. **Test on a full isolated copy of the migration chain with synthetic data.** Validate concurrency, failures, reprints, voids, refunds, reports and permission boundaries.
8. **Run a BIR-facing demo and submit required application documents.** Store the official certificate/PTU/approval and exact approved product/version scope before advertising the status.
9. **Roll out cautiously.** Backup/recovery check, migration review, explicit project ID confirmation, staged deployment, smoke tests, and post-release reconciliation monitoring.

## 6. Do not do these things
- Do not call Web2Table BIR-accredited before the approval is actually issued.
- Do not print `ORD-` as an official invoice serial.
- Do not invent EIS fields, API endpoints, document numbering or payload semantics.
- Do not automatically backfill old tax snapshots or issue invoices retroactively.
- Do not change VAT formulas without reviewed test vectors.
- Do not apply a broad order-table privilege revoke before legitimate application writes are moved and tested.
- Do not alter the connected database during this readiness stage; validate migrations in the isolated test project first.

## 7. Required external decisions
- Which BIR application route and taxpayer-user path apply to Web2Table and each tenant category?
- What exact current document fields, numbering/counters, reports, journal/close rules and retention obligations apply?
- Is BIR/EIS transmission required? If yes, which official ESP/certification route, technical specification/version, acknowledgement, outage and resubmission procedure apply?
- What are the BIR-approved tax treatments for non-VAT, VAT-inclusive/exclusive prices, statutory/loyalty discounts, fees, refunds and adjustments?
- Who will be the accountable taxpayer/software supplier, authorized signatory, tax adviser and owner of the evidence binder?

**Status:** readiness groundwork only. No accreditation, tax/legal determination, or production implementation is represented by this document.
