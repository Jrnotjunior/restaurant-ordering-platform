import { describe, expect, it } from 'vitest';
import {
  getRecordedReportDiscountTotal,
  getRecordedTaxSnapshotValue,
  getTaxSnapshotStatus,
  hasMissingTaxSnapshot,
} from './reportCalculations';

describe('getRecordedReportDiscountTotal', () => {
  it('does not add the derived loyalty component to a discount total that already includes it', () => {
    expect(getRecordedReportDiscountTotal({
      discountAmount: 125,
      loyaltyDiscountAmount: 25,
    })).toBe(125);
  });

  it('counts an online loyalty-only discount once when both values reflect the same discount', () => {
    expect(getRecordedReportDiscountTotal({
      discountAmount: 25,
      loyaltyDiscountAmount: 25,
    })).toBe(25);
  });

  it('does not guess a missing recorded total from the derived loyalty value', () => {
    expect(getRecordedReportDiscountTotal({
      discountAmount: null,
      loyaltyDiscountAmount: 25,
    })).toBe(0);
  });

  it('treats missing and non-finite recorded totals as zero', () => {
    expect(getRecordedReportDiscountTotal({ loyaltyDiscountAmount: 0 })).toBe(0);
    expect(getRecordedReportDiscountTotal({ discountAmount: Number.NaN })).toBe(0);
  });
});



describe('tax snapshot reporting safeguards', () => {
  it('flags a positive-total order with zero-default tax snapshot fields as missing', () => {
    const order = { total: 112, taxGrossSales: 0 };
    expect(hasMissingTaxSnapshot(order)).toBe(true);
    expect(getTaxSnapshotStatus(order)).toBe('Missing / unverified');
  });

  it('does not label a zero VAT result as missing when gross sales were recorded', () => {
    const order = { total: 100, taxGrossSales: 100 };
    expect(hasMissingTaxSnapshot(order)).toBe(false);
    expect(getRecordedTaxSnapshotValue(order, 0)).toBe(0);
    expect(getTaxSnapshotStatus(order)).toBe('Snapshot present');
  });

  it('leaves all exported tax values blank when the positive order has no gross snapshot', () => {
    const order = { total: 112, taxGrossSales: 0 };
    expect(getRecordedTaxSnapshotValue(order, 0)).toBe('');
    expect(getRecordedTaxSnapshotValue(order, 112)).toBe('');
    expect(getRecordedTaxSnapshotValue(order, null)).toBe('');
  });

  it('does not treat an order with no positive total as a missing positive-sale snapshot', () => {
    const order = { total: 0, taxGrossSales: 0 };
    expect(hasMissingTaxSnapshot(order)).toBe(false);
    expect(getTaxSnapshotStatus(order)).toBe('No positive order total');
    expect(getRecordedTaxSnapshotValue(order, 0)).toBe(0);
  });

  it('treats non-finite snapshot inputs as missing for a positive order', () => {
    expect(hasMissingTaxSnapshot({ total: 50, taxGrossSales: Number.NaN })).toBe(true);
    expect(getRecordedTaxSnapshotValue({ total: 50, taxGrossSales: 50 }, Number.NaN)).toBe('');
  });
});
