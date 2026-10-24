# Change Report — Cashier/Kitchen Workflow Boundary

**Date:** 24 October 2026 (Philippines time)  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`  
**Scope:** Prevent the cashier workspace from exposing kitchen status-management actions.

## Changes made

- Removed the no-kitchen-module fallback that allowed cashier users to advance orders through Preparing, Ready, and completion.
- Removed the cashier “Preparing & collection” panel that exposed orders already in kitchen/ready states.
- Restricted order status advancement in this page to the Kitchen role and the kitchen status RPC.
- Kept cashier cash confirmation, payment readiness checks, print/handoff, and the separate kitchen ticket intact.
- Added a regression test covering the cashier/kitchen role boundary.

## Files changed

- `src/pages/RestaurantOrdersPage.tsx`
- `tests/cashier-handoff-boundary.test.ts`

## Safety and verification

- No Supabase data, schema, payment records, historical orders, or tax snapshots were changed by this source edit.
- No tax classification or invoice-issuance setting was changed.
- Official BIR invoice issuance remains disabled; customer printouts remain operational receipts, not BIR-issued invoices.
- This change was committed directly to `main`, not a pull request.
- CI build/test and production build results must be checked for the final commit before claiming verification. Browser and physical-printer acceptance testing remains required.
