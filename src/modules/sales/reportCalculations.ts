/**
 * Returns the recorded total discount for sales reporting.
 *
 * In the orders model, discount_amount already stores the applied total:
 * POS statutory discounts plus any later loyalty redemption, or the loyalty
 * discount itself for online orders. loyalty_discount_amount is a derived
 * breakdown from loyalty transactions, not an additional amount to add.
 *
 * Keep missing historical values at zero rather than inferring a discount from
 * a secondary field; unresolved legacy records need explicit reconciliation.
 */
export type ReportDiscountAmounts = {
  discountAmount?: number | null;
  loyaltyDiscountAmount?: number | null;
};

export function getRecordedReportDiscountTotal(order: ReportDiscountAmounts): number {
  const amount = order.discountAmount ?? 0;
  return Number.isFinite(amount) ? amount : 0;
}
