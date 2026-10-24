# BIR POS accreditation readiness checkpoint

**Checked:** 2026-10-24  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`  
**Status:** Not BIR-accredited. Official invoice issuance remains disabled.

## Live production checks

Read-only aggregate checks were run against the Restaurant Ordering Platform Supabase project. No production rows were changed.

| Check | Current result | Meaning |
|---|---:|---|
| Orders with tax snapshot status other than `calculated` | 26 | The project owner confirms the current database contains test data only. Treat this as a test-dataset readiness gap, not evidence of missing real historical sales. |
| Order lines without a tax-category snapshot | 82 | Tax classification provenance is incomplete for existing order lines. |
| Menu products without a tax classification | 18 | Product categories must be reviewed against the taxpayer's actual registration and tax advice. |
| Taxpayer profiles configured | 0 | No taxpayer profile is available for route/identity review. |
| Invoice issuance configurations enabled | 0 | Official invoice issuance is not enabled. |
| Profiles containing BIR accreditation/PTU/Permit-to-Transmit references | 0 | No approval references have been recorded in taxpayer profiles. |

A separate live privilege check of the tax/BIR-related `SECURITY DEFINER` functions found **no anonymous execute grants** among the inspected functions. Authenticated execution is still guarded by per-function authorization checks and must continue to be covered by role/tenant tests.

## Engineering gates confirmed in source

- BIR readiness is explicitly reported as a platform checklist, not accreditation or tax advice.
- The readiness function checks taxpayer identity, route-specific approval references, serial-series configuration, product classification gaps, tax snapshot gaps, and non-VAT tax-basis verification.
- The invoice template and CWT field remain marked not ready until the accepted implementation exists.
- The readiness function returns `is_bir_accredited = false` and official invoice issuance remains disabled.
- Current printouts must remain labelled as operational receipts, not BIR-issued invoices.

## Next work order

1. **Confirm the actual regulatory route** with qualified Philippine tax counsel/BIR guidance: software supplier/Sales Machine, ESP, both, or another applicable path. Do not select a route based on guesswork.
2. **Complete the taxpayer profile from official documents** and record route-specific references only after their authenticity and applicability are verified.
3. **Resolve current tax-data gaps safely:** classify current menu products with accountant review, then build an explicit review/reconciliation path for historical order lines and sales. Preserve original transactions and snapshots; do not fabricate missing history.
4. **Finish the accepted statutory invoice specification**, including the required CWT field and conditional rules. Do not put guessed CWT amounts on an operational receipt.
5. **Implement and test the complete authorized issuance lifecycle** only after the route, approved template, serial requirements, void/reprint/adjustment/reporting requirements, and any transmission obligations are verified.
6. **Complete security and acceptance evidence:** cross-tenant/role negative tests, audit/reconciliation, browser receipt tests, and physical printer tests.

## Verification record

- Added a regression test that checks route evidence, tax-category mismatch, paid-sale snapshot, non-VAT tax-basis and official-issuance gates.
- Commit: `09ddab50625cabc3ff8b53d4fadaf6ce21834145`
- CI status for this new commit must be checked after the workflow run completes.
- No production data was changed by this checkpoint.


## Live recheck — 24 October 2026

A second read-only aggregate query was run against the production Supabase project after the latest route-review documentation commits. The project owner has clarified that **all data currently in this database is test data**. Therefore, the counts below describe the current test dataset and must not be presented as missing real historical sales. The results are unchanged:

| Check | Rechecked result |
|---|---:|
| Orders whose tax snapshot status is not `calculated` | 26 |
| Order lines missing tax-category snapshots | 82 |
| Products missing tax classification | 18 |
| Taxpayer profiles configured | 0 |
| Profiles with recorded BIR accreditation/PTU/Permit-to-Transmit references | 0 |
| Invoice issuance configurations enabled | 0 |
| Invoice issuance configurations present | 0 |

The query inspected aggregate counts only and did not read or modify individual customer/order records. No production writes were performed. These counts are a current checkpoint, not a substitute for tenant-specific review or a tax professional's sign-off.

The latest direct-to-`main` ESP-route review commit is `a1a9c8d155d08a14ca79276298043305a37541a9`. Its Hostinger production build and GitHub Pages deployment workflows both completed successfully. The runs were push-triggered and had no pull request attached. This confirms those build/deploy workflows only; it does not establish BIR accreditation or fiscal readiness.

The official BIR site continues to advertise an ESP application window of 16–30 October 2026. As of this checkpoint date (24 October), the platform must urgently verify eligibility, required documents and submission timing with BIR; the advertisement does not establish that Web2Table qualifies or has applied. The official BIR index lists RMC Nos. 110-2026 and 112-2026, but the signed full circulars and annexes still require direct verification before encoding detailed ESP/CWT obligations. Sources: https://www.bir.gov.ph/ and https://www.bir.gov.ph/whats-new.

**Decision remains unchanged:** official invoice issuance and BIR transmission stay disabled. No production rows or issuance configuration were changed during this recheck.


## Test order cleanup — 24 October 2026

The project owner confirmed the current database contains test data and explicitly authorized deleting orders while preserving users. Executed `DELETE FROM public.orders` against the configured production Supabase project, then verified the result with read-only counts.

| Verification | Result after cleanup |
|---|---:|
| Orders remaining | 0 |
| Order items remaining | 0 |
| Delivery assignments remaining | 0 |
| Discount beneficiaries remaining | 0 |
| Discount beneficiary line allocations remaining | 0 |
| Inventory order deductions remaining | 0 |
| Issued sales documents remaining | 0 |
| Auth users present | 13 |
| Order-deletion journal events recorded | 26 |

The database's foreign-key rules set `loyalty_transactions.order_id` and `pending_online_payments.order_id` to NULL when their parent order is deleted. The verification found 4 loyalty transaction rows and 8 pending online payment rows with no linked order. These rows were not independently deleted. The POS sales journal retained 26 `ORDER_RECORD_DELETED` events via its existing audit trigger.

No user records were targeted for deletion. The 13 auth users were present after cleanup; because no pre-delete user count was captured in this cleanup operation, this is a post-operation count rather than a before/after comparison. No invoice issuance settings were enabled or changed.

This cleanup removes the test orders and their cascading child records; it does not establish BIR readiness. Taxpayer profiles and approval evidence still need to be configured and verified before official invoice issuance can be enabled.


### Post-cleanup follow-up: orphaned online payments and loyalty rows

A read-only follow-up on 24 October 2026 found these rows after order deletion:

- `pending_online_payments`: 6 rows have status `paid` with `order_id IS NULL`; all 6 retain checkout-session IDs and checkout URLs. Another 2 rows have status `pending` with no order; 1 of these retains a checkout session and URL.
- `loyalty_transactions`: 4 `earn` rows remain unlinked, totaling 25 points.

No payment, loyalty, or customer rows were modified in this follow-up. The live `finalize_online_payment` function only returns an existing order for the `paid` plus non-null order-link case; a `paid` record with a null order link fails its non-pending status guard rather than recreating an order. The two still-`pending` payment records are different: if an outstanding checkout can still be completed and its webhook accepted, the finalization flow may create a new order. This should be resolved by reviewing/expiring or cancelling stale test checkout records through the supported payment workflow, after confirming the intended cleanup scope. Do not directly delete customer/user records or adjust customer loyalty balances as part of order cleanup.

These counts describe the test dataset only and are not evidence of real historical sales.
