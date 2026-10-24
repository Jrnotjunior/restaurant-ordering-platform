# Change Report — 80 mm Thermal Receipt Page Length

**Date:** 24 October 2026  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`

## Changes

- Changed the print page rule from a fixed 80 mm × 250 mm page to a variable-length 80 mm page to reduce premature page splits on long thermal receipts.
- Added a regression test for the variable-length page rule and the receipt print container's automatic height/visible overflow.

## Files changed

- `src/styles/restaurant-pos.css`
- `tests/cashier-handoff-boundary.test.ts`

## Safety and verification

- No database or production transaction data was modified.
- No historical tax snapshots, product classifications, or invoice-issuance settings were changed.
- This remains an operational receipt layout, not a claim of BIR invoice approval.
- Changes were committed directly to `main`, not via a pull request.
- CI must finish successfully for the latest commit, and the thermal-printer/browser print preview still needs manual acceptance testing. Printer drivers may interpret custom page lengths differently.
