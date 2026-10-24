# BIR POS readiness change report — sales reading discount-beneficiary gate

**Date:** 2026-10-24  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`

## Change

Updated the internal X/Z-style sales reading preview function so a paid sale with a recorded statutory discount beneficiary count cannot be reported as tax-summary-complete when any associated beneficiary record lacks a beneficiary name or address.

The reading's existing paid-sales tax-review count now includes this completeness check. Since the preview's `v_tax_complete` flag requires zero paid sales needing review, incomplete beneficiary details keep the summary marked incomplete.

## Why this matters

The readiness checklist already treats missing discount-beneficiary details as a tax review blocker. Aligning the sales-reading preview with that gate prevents two compliance surfaces from disagreeing about whether the same paid sales are complete.

## Safety boundaries

- Existing immutable reading snapshots are not rewritten.
- No production transaction, discount, tax snapshot, or taxpayer profile was changed by the code commit.
- The function continues to label its output as an internal preview, not an official BIR X-Reading, Z-Reading, invoice, tax return, or accreditation artifact.
- Official invoice issuance remains disabled.
- This change does not determine whether a particular discount is legally applicable; it only checks required record completeness.

## Commits

- Migration source: [preserve current reading logic and add beneficiary gate](https://github.com/Jrnotjunior/restaurant-ordering-platform/commit/9943a911788d9d4f5c1a79d1a79ba32add9aa22d)
- SQL terminator fix: [fix migration statement terminator](https://github.com/Jrnotjunior/restaurant-ordering-platform/commit/b262c0d5c9d325a7652da0c9153c661788f78e5f)
- Regression test: [test sales reading compliance gates](https://github.com/Jrnotjunior/restaurant-ordering-platform/commit/08efaea57b91c62c6bc12488d2db12f04a8d4613)

## Verification

- Applied successfully to the production Restaurant Ordering Platform Supabase project as migration `include_beneficiary_gaps_in_reading_preview`.
- Read back the live function definition and verified the beneficiary gate is present, non-VAT sales fields remain present, and output remains explicitly an internal preview.
- Checked function grants after deployment: `anon` cannot execute; `authenticated` can execute subject to the function's authorization guard.
- No sales, beneficiary, or tax snapshot rows were modified by this migration.
- GitHub Actions for the latest repository commit are still running; do not claim the regression suite passed until they finish.
