import { describe, expect, it } from 'vitest';
import { getRecordedReportDiscountTotal } from './reportCalculations';

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
