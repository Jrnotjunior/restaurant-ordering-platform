# BIR POS accreditation readiness checkpoint

**Checked:** 2026-10-24  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`  
**Status:** Not BIR-accredited. Official invoice issuance remains disabled.

## Live production checks

Read-only aggregate checks were run against the Restaurant Ordering Platform Supabase project. No production rows were changed.

| Check | Current result | Meaning |
|---|---:|---|
| Orders with tax snapshot status other than `calculated` | 26 | Existing sales need review; do not backfill or rewrite historical snapshots just to clear this count. |
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
