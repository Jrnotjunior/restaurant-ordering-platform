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


/**
 * Identifies positive-total orders whose tax snapshot cannot be distinguished
 * from the zero defaults in the current schema.
 *
 * This is a reporting safeguard, not a tax calculation and not proof that
 * snapshot data is BIR-compliant. A positive gross snapshot is required before
 * the recorded tax fields are presented as calculated values.
 */
export type ReportTaxSnapshot = {
  total?: number | null;
  taxGrossSales?: number | null;
  taxSnapshotStatus?: 'legacy_unknown' | 'not_calculated' | 'calculated' | 'requires_review' | null;
  taxZeroRatedSales?: number | null;
  itemsTaxClassified?: boolean;
  discountBeneficiariesComplete?: boolean;
  discountBeneficiaryCount?: number;
};

export function hasMissingTaxSnapshot(order: ReportTaxSnapshot): boolean {
  if (typeof order.total !== 'number' || !Number.isFinite(order.total) || order.total <= 0) return false;
  if (order.taxSnapshotStatus && order.taxSnapshotStatus !== 'calculated') return true;
  if ((order.discountBeneficiaryCount ?? 0) > 0 && order.discountBeneficiariesComplete !== true) return true;
  if (order.taxSnapshotStatus === 'calculated' && (
    typeof order.taxZeroRatedSales !== 'number'
    || !Number.isFinite(order.taxZeroRatedSales)
    || order.taxZeroRatedSales < 0
    || order.itemsTaxClassified !== true
  )) return true;
  return !(typeof order.taxGrossSales === 'number'
    && Number.isFinite(order.taxGrossSales)
    && order.taxGrossSales > 0);
}

/**
 * Avoids presenting schema-default zeros as recorded tax results when a
 * positive-total order has no positive gross-sales snapshot.
 */
export function getRecordedTaxSnapshotValue(
  order: ReportTaxSnapshot,
  value: number | null | undefined,
): number | '' {
  if (hasMissingTaxSnapshot(order)) return '';
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value;
}

/**
 * Provides a clear per-order status for support exports without claiming
 * that a present snapshot has been independently validated.
 */
export function getTaxSnapshotStatus(order: ReportTaxSnapshot): 'Legacy / unverified' | 'Not calculated' | 'Requires review' | 'Tax classification incomplete' | 'Missing / unverified' | 'Calculated snapshot' | 'No positive order total' {
  if (typeof order.total === 'number' && Number.isFinite(order.total) && order.total <= 0) {
    return 'No positive order total';
  }
  if (order.taxSnapshotStatus === 'legacy_unknown') return 'Legacy / unverified';
  if (order.taxSnapshotStatus === 'not_calculated') return 'Not calculated';
  if (order.taxSnapshotStatus === 'requires_review') return 'Requires review';
  if (order.taxSnapshotStatus === 'calculated' && (
    typeof order.taxZeroRatedSales !== 'number'
    || !Number.isFinite(order.taxZeroRatedSales)
    || order.taxZeroRatedSales < 0
    || order.itemsTaxClassified !== true
  )) return 'Tax classification incomplete';
  if (hasMissingTaxSnapshot(order)) return 'Missing / unverified';
  return 'Calculated snapshot';
}
