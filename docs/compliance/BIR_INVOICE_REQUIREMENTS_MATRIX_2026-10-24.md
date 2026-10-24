# Web2Table — Invoice Requirements Matrix (working draft)

**Updated:** 2026-10-24  
**Repository:** `Jrnotjunior/restaurant-ordering-platform` (`main`)  
**Status:** Engineering control matrix; not tax advice, not a BIR determination, and not evidence of accreditation or approval.

## Release guardrails

1. Keep current printouts labelled **“Operational receipt — not a BIR-issued invoice.”**
2. Do not assign or display an official invoice serial, accreditation reference, PTU, Permit to Transmit, or BIR transmission status unless the applicable identifier is verified against approved records.
3. Do not enable official issuance until Web2Table's applicable regulatory route and the tenant's prerequisites are confirmed in writing.
4. Never infer a customer's tax status, buyer withholding-agent status, CWT tax base/rate/ATC, or CWT amount from order type, payment method, or a generic percentage.
5. Do not backfill old invoices/transactions with fabricated tax classifications or identity data.

## Requirement matrix

| Area | Working requirement | Current evidence / gap | Engineering control / acceptance test | Approval dependency |
|---|---|---|---|---|
| Regulatory route | Confirm whether platform is pursuing Sales Machine/Software accreditation with tenant-user PTU handling, ESP accreditation, both, or another approved model. | Route decision brief exists; no approval or application is claimed. | Keep official invoice issuance disabled; store route status as unverified until evidence is reviewed. | Written BIR guidance / qualified Philippine tax professional. |
| Seller/taxpayer identity | Render the seller's legally registered identity and registration details required by the applicable invoice rules and approved template. | Taxpayer profile draft exists; profile is not proof of registration, PTU, or accreditation. | Validate required fields against BIR registration documents; distinguish platform review from BIR approval. | Tenant documents and applicable BIR format. |
| Official invoice numbering | Use a dedicated, controlled invoice series and running serial appropriate to the approved route; do not reuse order numbers. For the RMO 24-2023 Sales Machine/Software path, the referenced serial requirement includes a minimum six-digit running serial. | No approved invoice issuance ledger/serial allocator is implemented. | Before activation, add atomic serial allocation, uniqueness constraints, immutable issued-document records, concurrency/retry tests and audit history. | Route and serial format/sequence approval. |
| Invoice contents | Map mandatory seller/buyer data, invoice date, line descriptions, quantities, unit amounts, totals, applicable tax breakdowns, discounts, required statements and conditional fields to the approved format. | Cashier POS and staff order handoff now share one operational customer-receipt component; the current output remains an operational receipt, not an official invoice. | Build a field-by-field template with source column, condition, validation and output test for each field. Keep POS and staff handoff on the same template and test customer receipt versus the separate kitchen ticket. | Current RR/RMC plus approved route/template. |
| Receipt consistency and print separation | Every transaction path should render the same approved customer document; the kitchen production ticket must remain a separate internal document/page. | Shared `OperationalCustomerReceipt` now renders customer copies in both POS and staff order handoff; staff print layout isolates the body-level print portal and page-breaks the kitchen ticket. Official approved invoice design and end-to-end printer evidence remain open. | Compare output fixtures across order/payment types; reconcile fees, totals, discounts, tax fields and payment status; test thermal paper width, separate kitchen/customer pages, and reprint behavior. | BIR-approved/registered template and accountant review for the selected route. |
| VAT treatment | Separate VATable, VAT-exempt and zero-rated amounts where applicable; classify items and handle VAT-inclusive/exclusive prices and statutory discounts using accountant-approved rules. | Guarded mixed VAT-category calculation exists only for VAT-registered, VAT-inclusive orders with no discount and reconciled totals; not all combinations are approved. | Version rules; block official issuance when classification is missing or marked `requires_review`; test each combination. | Tenant tax registration and accountant sign-off. |
| Non-VAT sales breakdown | Separate sales subject to percentage tax from sales exempt from percentage tax when that distinction applies to the taxpayer; a sales breakdown is not the percentage-tax liability and must not be added as a generic customer charge. | A guarded version-4 technical snapshot now supports non-VAT classifications only after a source-reference is submitted and privileged review recorded; discounts, delivery fees, missing/unsupported line categories and mismatched totals remain under review. Existing history is not rewritten. | Verify the tenant's documented tax basis; classify current menu products with accountant review; add regression fixtures for categories, mixed lines, rounding and reconciliation; keep tax liability computation separate and disabled until approved. | Current registration documents and written Philippine tax advice; route-specific BIR requirements. |
| SC/PWD and other statutory discounts | Capture the legally required beneficiary, ID, discount and support data for each applicable statutory discount; preserve evidence without exposing it to unnecessary roles. | POS now captures beneficiary name, address, ID type/number and optional TIN; legacy incomplete records remain flagged. Other statutory categories and prescribed report formats still require review. | Validate eligibility, discount base and allocation; restrict access; test receipt/report consistency and missing-data lockout. | Current rules and accountant review. |
| Creditable withholding tax (CWT) | Include a configured invoice data element/phrase such as “Less: Withholding Tax”, “Less: Creditable Withholding Tax” or “Less: CWT”; display the amount separately only when the transaction is subject to CWT. Do not require an amount for transactions not subject to CWT. | CWT field/phrase is not implemented in the official invoice layout because official issuance is not enabled. RR No. 6-2026 and RMC No. 112-2026 need final primary-source verification and route-specific interpretation. | Add CWT as a separate optional data element, not a generic discount; capture buyer-provided withholding details when applicable; calculate only from verified ATC, tax base and rate; reconcile invoice, receivable and ledger. Test applicable and not-applicable cases. | Confirm official circular text, effective/transitory deadline for this taxpayer/system category, and accountant-approved decision rules. |
| Payment and CWT accounting | Keep gross sale recorded separately from CWT receivable/withheld amount; do not silently reduce sales or conflate CWT with payment processor fees, discounts or cash collected. | Current POS and online payment flows need unified tax/payment finalization review. | One idempotent finalization path; record gross invoice total, CWT where applicable, amount collectible, actual collection and any later remittance/withholding certificate separately. | Accountant-approved accounting mapping. |
| Voids, refunds, returns and corrections | Preserve the original issued document and link each void/refund/credit/correction to it; never reuse a serial. | No complete issued-document lifecycle/adjustment ledger. | Immutable issuance, reason/actor/time, adjustment links, permission checks, and reconciliation in fiscal reports. | Route-specific BIR treatment. |
| Reprints | Reprint the same issued document/serial and retain reprint audit metadata; never create a new invoice serial merely because paper is reprinted. | Current output is operational print and does not yet implement fiscal reprint semantics. | Test duplicate print, retry, lost response, and concurrent cashier actions. | Approved format and route. |
| Fiscal journal and daily readings | Implement the e-Journal and X/Z or equivalent readings/reports applicable to the selected route. RMO 24-2023 contains a conditional exception for subscription software that transmits sales data to BIR; do not assume it applies without confirming the conditions. | Internal append-only POS journal exists; it is explicitly not BIR-approved e-Journal. Official readings are not implemented. | Route-configured journal/readings; business-day close lockout where required; refund/void/discount/VAT reconciliation; reprint for audit; daily totals tie to issued documents. | Confirm route and any conditional exception. |
| Backend reports | Provide prescribed VAT category, statutory discount, void, sales summary and other route-required reports. | Internal sales/tax reporting exists but is not a complete approved fiscal report set. | Maintain report definitions, totals-to-ledger reconciliation and export tests against approved report examples. | Current prescribed forms and route. |
| Electronic invoice/transmission | If required for the selected taxpayer/system route, create structured invoice data and reliable transmission with acknowledgements, retries, idempotency and error reconciliation. | No BIR transmission/acknowledgement queue is implemented. | Never mark transmitted without a verified acknowledgement; retain payload/hash, status, attempts and response; no duplicate transmission on retry. | Tenant applicability, route, interface specification and access approval. |
| Tenant isolation and permissions | A tenant can only issue/read its own invoices, tax profile, journal and reports; sensitive beneficiary identity is available only to authorized roles. | Existing tenant RLS/RPC protections and restricted beneficiary reads are in place; full adversarial test matrix remains open. | Cross-tenant negative tests for every RPC and export; role tests for owner/cashier/dispatcher/system admin; no direct writes around privileged RPCs. | Security review and release sign-off. |
| Software version and material changes | Track approved software version and assess changes against the selected route's change-notification/approval rules. | Taxpayer profile has draft version/reference fields; no route-specific release gate is enforced. | Bind release version to route/approval metadata; require change review for invoice numbering, core sales recording, architecture, hosting, security or integration changes. | BIR determination for the selected route. |

## CWT implementation notes and transition timing (24 October 2026)

The official BIR 2026 Revenue Regulations index lists RR No. 6-2026, which amends the mandatory invoice information under RR No. 7-2024 to include applicable CWT information. The official BIR “What's New” page lists RMC No. 112-2026 as clarifying RR No. 6-2026 and providing transitory guidelines, and RMC No. 110-2026 as prescribing ESP accreditation, technical, operational, security, data-governance, institutional, legal and continuing-compliance requirements.

Official sources:
- RR No. 6-2026 index: https://www.bir.gov.ph/2026-Revenue-Regulations
- BIR current issuances index (RMC Nos. 110-2026 and 112-2026 listed): https://www.bir.gov.ph/whats-new
- BIR homepage / current ESP application advisory: https://www.bir.gov.ph/

Secondary professional and news summaries of RMC No. 112-2026 say the CWT amount is a separate invoice item only when the specific transaction is subject to CWT; it must not be treated as a generic discount, payment fee or extra charge. They report category-specific transition deadlines: generally 31 December 2026 for CAS/CBA and invoicing software covered by mandatory electronic invoicing, and 31 March 2027 for existing POS/CRM and systems not yet covered by mandatory electronic invoicing, subject to other BIR direction. They also describe a limited-system-change treatment for software changes solely to accommodate CWT, depending on the exact criteria and reporting obligations.

**These deadlines and change classifications are provisional in this engineering matrix** because the signed full circular/annex was not directly retrieved from the BIR-hosted attachment during this pass. Confirm the complete RMC No. 112-2026 text with BIR or Philippine tax counsel and classify each tenant/system before relying on a deadline. Do not assume every Web2Table tenant falls under the same invoicing category.

For implementation acceptance:
- Model CWT as a distinct, optional fiscal data element—not as an ordinary discount or universal buyer charge.
- Show the appropriate phrase and a separately recorded amount only when the particular transaction is confirmed to be subject to CWT; use only buyer/payor-supplied and accountant-approved withholding-agent status, ATC, tax base, rate and amount.
- For non-applicable transactions, follow the official text and approved route for blank, “N/A” or “0.00” presentation.
- Keep gross invoice sales, CWT withheld/receivable and net amount collectible separate in the invoice snapshot, payment record and accounting/reconciliation outputs.
- Include positive, not-applicable, malformed/missing buyer-data, rounding, reprint and reconciliation fixtures. Do not infer tax facts from restaurant order type, delivery/pickup, payment method or a generic percentage.

**Route urgency:** the official BIR homepage currently advertises an ESP accreditation application window from 16 through 30 October 2026. As of 24 October, this window is close to ending; Web2Table must obtain the official eligibility checklist and decide promptly whether ESP accreditation is relevant to its multi-tenant service model. An open window does not establish eligibility, a submitted application or accreditation.


## Required acceptance gates before enabling official issuance

- [ ] Regulatory route and tenant-specific applicability documented and reviewed.
- [ ] Seller registration, accreditation/PTU/permit identifiers verified against source documents.
- [ ] Approved invoice field/format matrix signed off by Philippine tax professional.
- [ ] Shared customer receipt template and separate kitchen-ticket printing pass end-to-end output comparison across POS and staff order handoff flows.
- [ ] Atomic invoice serial allocator and immutable issued-document lifecycle tested.
- [ ] VAT, VAT-exempt, zero-rated, and non-VAT percentage-taxable/exempt sales classifications and all statutory discount calculations signed off; percentage-tax liability must be modeled separately from sales classification.
- [ ] CWT applicability, buyer-supplied inputs, amount presentation and ledger reconciliation tested.
- [ ] Voids/refunds/reprints, day close, fiscal readings and required backend reports implemented.
- [ ] Transmission and acknowledgement handling implemented if required.
- [ ] Tenant/role security tests, concurrency tests and end-to-end production-like acceptance tests pass.
- [ ] Formal BIR submissions, permits, accreditation and any required demonstration/approval completed.

**Release statement:** This matrix is a planning/control artifact only. Web2Table must not be represented as BIR-accredited or as issuing official BIR invoices until all applicable gates are satisfied.

## Regulatory update — 24 October 2026 (CWT and ESP requirements)

This section records newly indexed BIR issuances and prevents the earlier working draft from being treated as the final approved invoice specification.

### Primary-source status

- BIR's official **2026 Revenue Regulations** index lists RR No. 6-2026 (1 October 2026), amending mandatory invoice information to include creditable withholding tax (CWT) information: https://www.bir.gov.ph/2026-Revenue-Regulations
- BIR's official **What's New** index lists RMC No. 112-2026 as clarifying RR No. 6-2026 and providing transitory guidelines, and RMC No. 110-2026 as prescribing ESP accreditation, technical, operational, security, data-governance, institutional, legal and continuing-compliance requirements: https://www.bir.gov.ph/whats-new
- The official BIR homepage advertises ESP accreditation applications for 16–30 October 2026 and separately displays a 14 September advisory stating no entity had been accredited/authorized/recognized as an ESP as of that date. That older advisory does not establish the status of any specific applicant today: https://www.bir.gov.ph/
- RMO No. 24-2023 remains the primary source to assess for the traditional POS/Sales Machine/Software accreditation path: https://bir-cdn.bir.gov.ph/local/pdf/RMO%20No.%2024-2023.pdf

The BIR index confirms the issuances exist, but this engineering pass has not independently verified every clause against the signed official full text of RMC Nos. 110-2026 and 112-2026. Do not treat a secondary summary or OCR extraction as a substitute for the signed circular, annexes, and current BIR checklist.

### Updated engineering controls

| Control | Current interpretation for engineering | Gate / evidence still required |
|---|---|---|
| CWT invoice field | Model the CWT phrase/field as an available part of the registered/accredited invoice configuration, not as a generic discount. Do not force a CWT amount on every sale. | Verify the signed RR 6-2026/RMC 112-2026 texts and applicable transition period with the relevant BIR office/tax adviser. |
| CWT applicability | Do not infer that CWT applies because an order is B2B, online, or paid by a particular method. The buyer/payor's withholding obligation and transaction facts matter. | Capture buyer-provided withholding-agent status and applicable classification/ATC, rate, base and amount only when applicable and reasonably determinable; keep provenance and actor audit. |
| Gross sale and CWT | Preserve the gross invoice/sales amount. If applicable, represent CWT separately and reconcile net amount due; do not deduct CWT from gross sales, VAT sales or VAT base as if it were a discount. | Accountant-reviewed accounting mapping and tests for applicable/non-applicable CWT cases. |
| CWT auditability | Changes to CWT treatment need actor/time and traceability; supporting invoice, books and withholding certificate should reconcile where applicable. | Schema and permission review before implementation; regression tests for unauthorized edits and post-issuance changes. |
| System-change classification | Do not assume a CWT-only modification automatically requires a full new accreditation, or that it never requires notification. | Obtain and apply the exact RMC 112-2026 limited-vs-material system-change conditions and any RMO 24-2023/RMO 9-2021 notice requirements. |
| ESP route | ESP accreditation is a distinct route with its own current accreditation requirements; it does not automatically replace taxpayer/tenant-specific POS/CAS/PTI obligations. | Determine the platform's actual service model and eligibility; obtain the official current checklist and written route guidance. Do not claim ESP status. |
| Official issuance gate | Keep official invoice issuance disabled until the selected route, tenant identity, required registrations/permits, invoice specification, serial control and applicable transmission/reading requirements are verified. | Written BIR/qualified Philippine tax guidance plus complete tenant evidence and acceptance results. |

### Next implementation order

1. Obtain and archive the signed official RMC 110-2026 and RMC 112-2026 texts plus annexes/checklists; review the official text rather than secondary extracts.
2. Record a route decision for this platform: traditional Sales Machine/Software supplier path, ESP path, both, or another written BIR-approved model. Do not make a route selection by inference.
3. Once the route and applicable CWT transition are confirmed, implement the CWT field as a separate optional fiscal element behind the existing issuance gate, with provenance/audit fields and tests. Do not enable official issuance as part of that change.
4. Re-run readiness counts and test the tenant-specific registration/identity gates before any issuance pilot.

**No production data or issuance configuration was changed by this documentation update.** This matrix remains an engineering work product, not legal advice, a BIR determination, or evidence of accreditation.
