# Web2Table Restaurant Ordering Platform — Project Handover

**As of:** 24 October 2026 (Philippines time)  
**Repository:** [Jrnotjunior/restaurant-ordering-platform](https://github.com/Jrnotjunior/restaurant-ordering-platform)  
**Working branch:** `main`  
**Primary goal:** Stabilize restaurant POS/order workflows and receipt printing while preparing the product for a properly verified BIR compliance route.  
**Important status:** The product currently prints operational receipts, **not BIR-issued invoices**. Official invoice issuance must remain disabled.

## 1. Executive summary

The core restaurant workflows exist: customer storefront/self-ordering, customer order tracking, a cashier POS, staff New Orders, kitchen workflow, delivery/dispatch, online payment, cash payment confirmation, discounts and receipt printing. The recent work focused on making the cashier POS and staff New Orders handoff use the same operational customer-receipt component, keeping the kitchen ticket as a separate internal slip, removing receipt printing from the customer tracking page, and closing the cashier order modal after a print/kitchen handoff.

The latest checked application commit before this handover was `4ecafacdfe0481f2c2120953d495bd3313632952` (“Isolate staff receipt printing from modal layout”). On that commit, the build/regression tests, Hostinger production build and GitHub Pages deployment all reported success:

- [Build and regression tests](https://github.com/Jrnotjunior/restaurant-ordering-platform/actions/runs/40029520397)
- [Hostinger production build](https://github.com/Jrnotjunior/restaurant-ordering-platform/actions/runs/40029520351)
- [GitHub Pages deployment](https://github.com/Jrnotjunior/restaurant-ordering-platform/actions/runs/40029520478)

These are CI/deployment checks, **not** proof that every physical printer, payment scenario or live tenant workflow has passed acceptance testing. Do not keep adding features before the next round of hands-on tests.

## 2. Receipt workflow — source of truth

### Intended behavior

1. **Cashier POS orders:** cashier completes the POS order/payment workflow. The cashier print view can print the customer receipt and the separate kitchen ticket.
2. **Customer self-order / online storefront:** customer checkout sends the customer to order tracking. Order tracking shows status and order details; it must not offer staff receipt-printing actions.
3. **Storefront orders that appear in the restaurant's New Orders queue:** the staff cashier validates payment state, prints the staff/customer handoff slips and sends the order to the kitchen. Cash orders are not considered paid until the cashier confirms collection. Online-paid orders must not be sent to the kitchen until payment is confirmed.
4. **Kitchen workflow:** receives the kitchen ticket and manages later steps such as preparing/ready. The cashier's print/handoff modal should close after a successful handoff; the cashier should not be left in a “Mark Ready” kitchen action unless the tenant deliberately operates without a separate kitchen module and the role policy allows it.
5. **Customer tracking:** no customer-facing print button. A previous attempt to put a large customer receipt into order tracking was reverted after owner feedback.

### Shared template now in code

- `src/components/OperationalCustomerReceipt.tsx` — shared operational customer receipt layout for cashier POS and staff New Orders.
- `src/pages/RestaurantCashierPosPage.tsx` — POS order flow, preview, kitchen slip and shared customer receipt.
- `src/pages/RestaurantOrdersPage.tsx` — restaurant order list/modal, cash confirmation, staff print-and-send flow, separate kitchen ticket and shared customer receipt.
- `src/styles/restaurant-pos.css` — receipt thermal-width styling and staff print-area isolation.
- `src/pages/OrderTrackingPage.tsx` and `src/styles/order-tracking.css` — customer tracking only; staff receipt component was removed here.

Recent receipt-related commits, in order:
- `3ec81fa` Create shared operational customer receipt template.
- `8ad47f4` Clean up shared receipt component imports.
- `b8e0b98` Use shared customer receipt template in POS.
- `9ee2676` Standardize staff order receipts and isolate print layout.
- `7b19c26` Isolate staff receipt printing from modal layout.
- `b36f785` Test shared operational receipt template.
- `c54c4cb` Track receipt consistency in BIR readiness workflow.
- `4ecafac` Isolate staff receipt printing from modal layout.
- `349a509` and `7aa4b98` Remove the misplaced storefront receipt and its styles.
- `b66d47d` Close cashier order modal after cash receipt print.

**Current implementation status:** the templates have been unified in the source and CI is green. Still required: live browser/thermal-printer acceptance testing to confirm both customer receipts render identical required fields and totals, print in the expected order alongside the kitchen ticket, and do not leave a stale modal open. The screenshot showing two visibly different customer receipts was taken before the latest shared-template changes; do not assume the problem is resolved until the deployed site is tested directly.

## 3. Other work already completed

### SC/PWD statutory-discount workflow

- POS accepts a group/customer count and registered Senior Citizen or PWD beneficiaries.
- The previously long per-product eligible-amount entry UI has been removed. The current helper `allocatePosEqualGroupShares` automatically apportions each order line among the configured group, then allocates the designated beneficiary share(s); cent remainders are spread while respecting each line's total.
- The POS preview uses `src/modules/pos/statutoryDiscountCalculations.ts`; tests live in `src/modules/pos/statutoryDiscountCalculations.test.ts`.
- Frontend prevents loyalty reward redemption alongside SC/PWD statutory discounts.
- Database RPC `redeem_loyalty_reward` also rejects loyalty redemption if statutory beneficiaries are recorded, enforcing the mutual-exclusion rule beyond the UI.
- Database migration `20261024258000_pos_statutory_discount_line_allocations.sql` records line-level allocation data and validates order/line relationships and limits.
- Database migration `20261024259000_prevent_stacking_loyalty_and_statutory_discounts.sql` enforces the no-stacking guard.
- Database migration `20261024260000_validate_discount_id_type_by_benefit.sql` adds the ID-type allowlist check: Senior supports OSCA/National Senior ID/passport/other government ID; PWD supports PWD ID/passport. Five negative cases were checked against the primary database and rejected by the intended constraint, with no rows committed.

**Important legal/tax caution:** the owner requested equal division by customer count as the desired cashier UX. That implementation is a product rule, not a confirmation that equal allocation is correct under every statutory-discount fact pattern. A Philippine tax professional must approve which goods/quantities qualify, treatment of shared dishes, the 20% discount base and VAT treatment before real SC/PWD transactions rely on it. Do not remove the tax review state just because arithmetic tests pass.

### Tax snapshot safeguards

Migrations in the `20261024251xxx`–`20261024259000` series implemented narrow calculation support, product-derived tax-category snapshots, and review guards. The current implementation can calculate selected supported standard/exempt/zero-rated cases; unsupported/unclassified/legacy/statutory-discount cases must not be treated as approved tax results.

- Statutory-discount tax snapshots remain `requires_review` unless and until the rule is reviewed and approved.
- Product tax categories are derived server-side from catalog/restaurant data, not trusted from the client. Historical orders are not automatically backfilled.
- For ordinary online orders, calculation support is deliberately narrow and does not change the customer's total.
- A prior read-only DB inspection found the test restaurant's VAT flags disabled and existing product/order-item tax category snapshots null. Do not bypass tenant/admin controls to make a test pass; prepare a properly configured test tenant first.

### Database environments

The engineering work has been applied to these two Supabase projects:
- Primary: `xaihajwrsvcdjisezmmc`
- Isolated security test: `rgkyaulipliqcdzkppvq`

Always confirm the intended project before running a migration or SQL test. Use rollback-only/synthetic testing and avoid touching live customer/order data. The test project had no orders at a previous check; use a dedicated test order/tenant instead of assuming existing fixtures exist.

## 4. Known items that still need work

### Priority 1 — release acceptance tests for the receipt/hand-off paths

Run these after refreshing the actual deployed site:
1. **Cashier POS cash order:** compare printed customer receipt and kitchen ticket. Verify order number appears once; customer/order type/date; every line/quantity; subtotal; discounts; fee; total; actual cash received/change; and correct paid state.
2. **Customer self-order, cash:** order appears in New Orders as unpaid/pending. Cashier confirms cash and completes print/handoff; both receipts print and modal closes. No path marks it paid before cash is actually received.
3. **Customer self-order, online:** order appears only as eligible for handoff after confirmed online payment. Print shared customer receipt plus the distinct kitchen ticket; confirm the final total/fee and payment state agree with the saved order.
4. **Delivery/COD:** verify it stays unpaid until the rider collects money, using the rider collection flow; after collection it should be marked paid exactly once. Confirm the receipt status is consistent with the actual collection state.
5. **Printer/layout:** verify the customer receipt and kitchen ticket each occupy the intended paper/page, the kitchen ticket remains separate, 80 mm thermal print works, there is no blank/extra first page, and re-opening an order doesn't accidentally alter or duplicate payment.
6. **Discounts:** verify beneficiary share and discount are consistent between POS preview, saved order, cashier receipt and reports. Use only a test tenant until accountant-reviewed tax treatment is approved.

### Priority 2 — receipt and fiscal data completeness

The shared component harmonizes layout, but a shared template alone does not establish BIR compliance. Confirm the appropriate fields and conditional visibility across POS and staff handoff. Current receipt remains explicitly labelled “Operational receipt — not a BIR-issued invoice.” Do not use the order number as an invoice serial.

### Priority 3 — tax/accounting approval and invoice-readiness architecture

Existing design documents:
- `docs/compliance/BIR_INVOICE_REQUIREMENTS_MATRIX_2026-10-24.md`
- `docs/compliance/BIR_POS_CODE_AND_SCHEMA_AUDIT_2026-10-20.md`
- `docs/compliance/BIR_POS_REGULATORY_ROUTE_DECISION_BRIEF_2026-10-20.md`

Key gaps recorded in those documents:
- Product route is not yet settled in writing: supplier/Sales Machine or Software accreditation with tenant-user PTU handling, ESP/e-invoice transmission route, both, or another approved route.
- No evidence of a submitted BIR application or granted accreditation/authorization in this project handover.
- No controlled invoice-issuance ledger and dedicated invoice serial allocator.
- No immutable issued-document lifecycle for duplicate/reprint, void, refund, return, correction and audit.
- Backend tax/accounting reporting, fiscal journal/X-Z or equivalent duties, zero-rated reporting, SC/PWD/Solo Parent/void reports, CWT handling and end-of-day reconciliation need route-specific review and tests.
- Current VAT and SC/PWD computations are not accountant-approved for all combinations; never turn on invoice issuance while required classifications/calculations are under review.

The existing regulatory brief said the BIR site was advertising an ESP application window of **16–30 October 2026** as of the last review; as of this handover (24 October 2026), immediately re-check the current official BIR portal and confirm the actual route/eligibility and deadline directly with BIR or Philippine tax counsel. The window and status are time-sensitive; do not rely solely on search snippets or a third-party reproduction of a circular.

### Priority 4 — other bugs and product follow-ups from owner

These have been reported and must be re-tested before they can be called resolved:
- **Custom-domain tenant isolation:** tenant may be able to sign in on another restaurant's custom domain and see the wrong restaurant; the expected behavior is a clear error/denial, never cross-tenant access. Test direct URLs and redirects for owner/staff/cashier.
- **COD payment state:** ensure COD is not marked paid until rider collects cash, and that the existing rider tracking “collect money” interaction is actually wired to the saved payment status.
- **Rider dashboard delivery fee:** reported mismatch where details omitted delivery fee while order total included it.
- **Cashier direct-link/blank page:** owner wondered whether a blank page on a direct cashier link might be network-related. Confirm route, authentication, tenant custom domain and console/network response; don't assume it is the internet.
- **Restaurant-configured UI:** modal/background and primary-button consistency should follow tenant restaurant styling.
- **Payment/report visibility:** make paid versus pending collection easy to find and reconcile.

## 5. Working rules for the next developer

- The owner prefers **small, direct commits on `main`**, not a queue of PRs that cannot be tested immediately. Keep each code change narrowly scoped; don't batch unrelated tasks.
- After each change, wait for build/regression tests and production build/deployment jobs to finish and inspect the conclusion before saying it is ready.
- No claims of success based on a green build alone. Always call out what still requires manual test.
- Do not claim BIR accreditation, certification, authorization or invoice compliance without official evidence.
- Keep “Operational receipt — not a BIR-issued invoice” visible until official issuance is explicitly approved and implemented.
- Preserve payment-state integrity: unpaid cash/COD is not paid until actual collection; online orders are not handed to kitchen until confirmed paid.
- Do not backfill missing product classifications, beneficiary identity, invoice serials or historical tax snapshots by guessing.
- The appropriate stopping point after this handover is **receipt/payment/kitchen workflow acceptance testing**, not another feature expansion.

## 6. Suggested first message/action for the next session

Start by checking the latest `main` commit and its CI run statuses. Then perform the six acceptance tests under Priority 1 using a dedicated test restaurant and test payments. Record any discrepancy with the order number, order type, payment method/status, line subtotal, delivery fee, discount, total, receipt photo and which workflow generated it (POS vs New Orders). Fix only the first reproducible discrepancy, then re-run checks. In parallel, arrange written confirmation of the BIR route and accountant review; do not activate official invoice issuance in the meantime.
