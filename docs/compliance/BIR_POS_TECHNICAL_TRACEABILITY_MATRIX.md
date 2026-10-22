# Web2Table POS — BIR Technical Requirements Traceability Matrix (Initial)

**Date reviewed:** 2026-10-20  
**Scope:** Multi-tenant restaurant POS software; supplier accreditation plus tenant-specific registration support  
**Status:** Initial traceability pass. Not legal advice, not a completed technical evaluation, and not evidence of BIR approval.

## Regulatory sources to pin and review before implementation

| Source | What it affects | Action |
|---|---|---|
| BIR RMO No. 24-2023 and annexes | Sales-machine/software accreditation; required functionality; report and invoice examples; supplier/user process | Obtain complete official text and annexes; map each clause to a test |
| BIR RR No. 7-2024, as amended by RR No. 11-2024 | Principal invoice requirements, taxpayer registration, invoice fields, transitional rules | Use the consolidated current rules, not an old sample receipt |
| BIR RMC No. 77-2024 | Clarifications and sample invoice format under EOPT invoicing changes | Validate current invoice fields and seller/buyer scenarios |
| BIR RR No. 6-2026 (October 1, 2026) | Amends mandatory invoice information to include creditable withholding tax information | Review full text and applicability to restaurant transactions; validate conditional requirements before implementation |
| BIR RMC No. 98-2026 (September 22, 2026) | Policies/guidelines for electronic invoice under RR 8-2022 and RR 11-2025, as amended by RR 26-2025 | Determine if planned SaaS POS/e-invoicing path is covered and what certification/transmission path is required |
| Current BIR eAccReg/e-Invoice portals and later issuances | Current application route, certificates/permits, technical interface and transmission obligations | Verify live application checklist and obtain written clarification from the responsible RDO/LT office |

Official starting points:
- RMO No. 24-2023: https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf
- RR No. 7-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RR%207-2024%20%28final%29.pdf
- RMC No. 77-2024: https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2077-2024.pdf
- BIR 2026 Revenue Regulations: https://www.bir.gov.ph/2026-Revenue-Regulations
- BIR 2026 Revenue Memorandum Circulars: https://www.bir.gov.ph/2026-Revenue-Memorandum-Circulars
- BIR e-Invoice Certification portal: https://eis-cert.bir.gov.ph/

## Traceability matrix

Status meanings:
- **Partial evidence**: related code exists, but this is not proof of requirement compliance.
- **Not verified**: inspected paths did not establish compliance; inspect further before deciding absent.
- **External confirmation**: requires current BIR interpretation, formal application or approval.

| Requirement / control | Initial repository evidence | Status | Evidence needed / next action |
|---|---|---|---|
| Correct supplier/software accreditation and tenant registration pathway | Existing audit identifies POS and subscription-based invoicing as separate regulatory questions | External confirmation | Confirm Web2Table's role, whether invoice generation is included, applicable supplier/software accreditation and tenant-specific permit/registration route with BIR |
| Registered taxpayer identity per tenant and branch | Tax settings migration adds VAT registration flag, inclusive-price flag and rate; reviewed migration does not add registered invoice identity fields | Not verified / likely gap | Inspect existing restaurant profile schema; map legal name, TIN, registered address, branch code and registration references to authoritative, permissioned fields |
| Correct invoice type per taxpayer | VAT flag exists in POS tax settings | Partial evidence | Model VAT/non-VAT taxpayer status and approved invoice type; reject issuance when profile is incomplete/unverified |
| Required invoice data fields | POS print type contains order number, customer, date, items and financial totals | Partial evidence | Compare actual print template against current rules and RR 6-2026; inspect seller identity, TIN, address, serial, VAT/tax breakdown and conditional withholding information |
| Separate authorized invoice serial from order number | Migration 20261004205114_restaurant_specific_sequential_order_numbers.sql creates ORD- order numbering and a restaurant order counter | Not verified / critical risk | Build a separate invoice issuance entity and sequence, with required minimum digit count/format and approval state based on official rules; do not relabel order IDs as invoice numbers |
| Concurrency-safe issuance | Order counter uses atomic upsert for order numbers | Partial evidence | Add race/retry/idempotency tests for invoice issuance; ensure no duplicate serial and no silent reuse after issuance |
| Accumulated grand total sales | Tax snapshot columns exist on orders | Not verified | Identify required grand-total semantics, persistent counter and reset rules; demonstrate reconciliation and recovery |
| Tamper-free transaction record | Order snapshots preserve historical tax values according to migration comments | Partial evidence | Inspect database policies, triggers, RPC permissions and administrative mutation paths; enforce append-only journal or tamper-evident controls for issued sales |
| Activity / transaction log | Repository has system administration audit-related features, but not enough evidence in reviewed paths to prove POS event coverage | Not verified | Trace sales, invoice, discount, void, refund, reprint, configuration and cashier events; ensure actor, timestamp, reason and tenant are captured |
| Electronic/audit journal | No complete POS journal evidence in inspected paths | Not verified | Confirm current exception for subscription-based e-invoicing that transmits sales data to BIR applies to Web2Table; otherwise implement prescribed journal/equivalent |
| X-Reading / Z-Reading or applicable substitute | No complete readings found in inspected files | Not verified | Read applicable RMO 24-2023 clauses/annexes; determine if SaaS transmission exception applies; implement only the required model and lock business date after Z-close where required |
| BIR Sales Summary / backend reports | Business Reports page exports tax-support sales data and disclaims official status | Partial evidence / gap likely | Map fields and calculations to current BIR annexes; generate separate VATable, VAT-exempt and zero-rated totals where applicable, plus relevant discount, void and other prescribed reports |
| Senior citizen / PWD / other statutory discount records | POS includes beneficiary types and server-side group discount RPC | Partial evidence | Validate legal eligibility, documentary fields, eligible base, VAT treatment, discount and exemption calculations against current law; protect ID data and test mixed groups |
| Reprint/copy behavior | Receipt print view exists | Partial evidence | Preserve original issued record; label duplicate/reprint as prescribed, log who reprinted and when, never create a new sale or serial on reprint |
| Void/refund/return/cancellation | Orders and payment flows exist; full lifecycle not verified | Not verified | Ensure issued documents are not deleted; record linked adjustment/void/refund, authorization, reason, timestamps and report treatment |
| Push / transmission functionality | Supabase backend and external services exist, but BIR sales-data transmission not established | Not verified / external confirmation | Determine whether Web2Table must transmit and the approved channel/specification; implement retry queue, delivery acknowledgement, reconciliation, monitoring and secure credentials only after BIR confirmation |
| Verification/validation seal | Not established in inspected files | Not verified | Confirm exact required seal/verification method for selected POS/e-invoice route; implement only from official specification |
| Data retention and non-volatile persistence | Supabase persists order records; prescribed retention and tested restoration not established | Partial evidence | Confirm required retention period, backup/restore and export requirements; test integrity and restore process |
| Tenant/branch isolation | RPC get_restaurant_tax_settings checks restaurant owner or active cashier | Partial evidence | Audit every relevant RPC/table policy and report/export; run cross-tenant negative tests, including staff roles and service-role paths |
| Tax calculation and snapshot correctness | Server-side tax/discount snapshot columns and RPCs exist | Partial evidence | Test VAT inclusive/exclusive, VAT/non-VAT, exemptions, zero-rated cases if applicable, statutory discounts, rounding, mixed orders, delivery/fees and refunds with tax-professional-approved expected results |
| Invoice/report retention after setting changes | Migration comments describe historical order snapshots | Partial evidence | Test historical outputs are stable after tax settings/profile updates and preserve applicable software/config version |
| Error/offline/retry behavior | Not verified | Not verified | Test network loss, timeout, duplicate submit, payment failure, printer failure, restoration and concurrent checkout; never lose an accepted sale or duplicate a document |
| Product/version identity and upgrade governance | Application repository/version exists; accreditation version mapping not established | External confirmation / gap | Define release/version identity and change-control process; determine when enhancements require notification or new accreditation based on current BIR rules |
| Demo and documentary package | Initial audit document exists | Partial evidence | Build clause-linked demo scripts, sample data, report samples, system architecture, manuals, test reports, sworn statements and current application documents as required by BIR |

## Immediate next engineering tasks

1. Inspect the full invoice/receipt rendering and every order mutation/void/refund path.
2. Inspect the database schema, RLS policies, triggers, and definitions/grants for every RPC used to create, finalize, discount, pay, cancel, refund, and report orders.
3. Inventory existing journal, daily close, readings, report and transmission functions before creating new schema.
4. Create a testable financial calculation specification and fixture set for VAT/non-VAT and statutory discounts, reviewed by a Philippine tax professional.
5. Obtain current BIR guidance on the applicable RMO 24-2023 exception for subscription-based e-invoicing that transmits sales data, and the 2026 electronic-invoice rules.
6. Only after these checks, propose a migration and implementation PR with explicit tests. Do not change production data or imply BIR approval.

## Guardrails

- Do not represent an order number as a registered invoice serial.
- Do not print “BIR-accredited,” “BIR-approved,” or equivalent claims until formal approval is obtained.
- Do not hard-code tax behavior based on a single sample invoice.
- Do not treat a successful payment redirect as proof that a sale is properly invoiced or recorded.
- Any conclusion that a requirement is absent must be backed by a full code/schema search and test, not just the absence of a feature in one page.
