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

- Migration: `f0ee380d493e5320cfe45aa81ed764c321bbc489`
- Regression test: `8c824ec5356da2568a9d6ad5a619ae2b2e33c914`

## Verification

CI should be checked after the latest commit finishes. The migration must be applied to the intended Supabase project through the normal deployment process before its live behavior is relied upon. The current code/test change does not by itself prove that the migration has been deployed to production.
