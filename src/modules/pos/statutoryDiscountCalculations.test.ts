import { describe, expect, it } from 'vitest';
import { calculatePosStatutoryDiscountPreview } from './statutoryDiscountCalculations';

const mixedLines = [
  { productId: 'standard', lineTotal: 112, taxCategory: 'standard_rate' as const },
  { productId: 'exempt', lineTotal: 50, taxCategory: 'vat_exempt' as const },
  { productId: 'zero', lineTotal: 25, taxCategory: 'zero_rated' as const },
];

const mixedAllocations = [
  { productId: 'standard', taxCategory: 'standard_rate' as const, eligibleGross: 56 },
  { productId: 'exempt', taxCategory: 'vat_exempt' as const, eligibleGross: 25 },
  { productId: 'zero', taxCategory: 'zero_rated' as const, eligibleGross: 10 },
];

describe('calculatePosStatutoryDiscountPreview', () => {
  it('reconciles VAT-inclusive mixed-category lines, eligible allocations, and payable total', () => {
    const result = calculatePosStatutoryDiscountPreview({
      lines: mixedLines,
      allocations: mixedAllocations,
      subtotal: 187,
      deliveryFee: 12,
      vatRegistered: true,
      pricesVatInclusive: true,
      vatRate: 12,
    });

    expect(result.allocations).toEqual([
      { ...mixedAllocations[0], eligibleGross: 56, eligibleNet: 50, discountAmount: 10 },
      { ...mixedAllocations[1], eligibleGross: 25, eligibleNet: 25, discountAmount: 5 },
      { ...mixedAllocations[2], eligibleGross: 10, eligibleNet: 10, discountAmount: 2 },
    ]);
    expect(result.discountAmount).toBe(17);
    expect(result.allocatedEligibleGross).toBe(91);
    expect(result.vatableSales).toBe(50);
    expect(result.vatAmount).toBe(6);
    expect(result.vatExemptSales).toBe(85);
    expect(result.zeroRatedSales).toBe(23);
    expect(result.netSales).toBe(158);
    expect(result.preLoyaltyTotal).toBe(164);
    expect(result.totalWithDeliveryFee).toBe(176);
    expect(result.totalWithDeliveryFee).toBe(
      result.vatableSales + result.vatAmount + result.vatExemptSales + result.zeroRatedSales + 12,
    );
  });

  it('uses the entered eligible amounts as VAT-exclusive amounts when menu prices exclude VAT', () => {
    const result = calculatePosStatutoryDiscountPreview({
      lines: mixedLines,
      allocations: mixedAllocations,
      subtotal: 187,
      deliveryFee: 12,
      vatRegistered: true,
      pricesVatInclusive: false,
      vatRate: 12,
    });

    expect(result.allocations.map(({ eligibleNet, discountAmount }) => ({ eligibleNet, discountAmount }))).toEqual([
      { eligibleNet: 56, discountAmount: 11.2 },
      { eligibleNet: 25, discountAmount: 5 },
      { eligibleNet: 10, discountAmount: 2 },
    ]);
    expect(result.discountAmount).toBe(18.2);
    expect(result.vatableSales).toBe(56);
    expect(result.vatAmount).toBe(6.72);
    expect(result.vatExemptSales).toBe(89.8);
    expect(result.zeroRatedSales).toBe(23);
    expect(result.netSales).toBe(168.8);
    expect(result.preLoyaltyTotal).toBe(175.52);
    expect(result.totalWithDeliveryFee).toBe(187.52);
    expect(result.totalWithDeliveryFee).toBe(
      result.vatableSales + result.vatAmount + result.vatExemptSales + result.zeroRatedSales + 12,
    );
  });

  it('does not add VAT for non-VAT-registered restaurants and includes delivery in the payable total', () => {
    const result = calculatePosStatutoryDiscountPreview({
      lines: [
        { productId: 'meal', lineTotal: 80, taxCategory: null },
        { productId: 'drink', lineTotal: 20, taxCategory: null },
      ],
      allocations: [
        { productId: 'meal', taxCategory: null, eligibleGross: 50 },
        { productId: 'drink', taxCategory: null, eligibleGross: 10 },
      ],
      subtotal: 100,
      deliveryFee: 20,
      vatRegistered: false,
      pricesVatInclusive: false,
      vatRate: 12,
    });

    expect(result.discountAmount).toBe(12);
    expect(result.vatableSales).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.vatExemptSales).toBe(0);
    expect(result.zeroRatedSales).toBe(0);
    expect(result.preLoyaltyTotal).toBe(88);
    expect(result.totalWithDeliveryFee).toBe(108);
  });

  it('rounds discounts per allocation line before summing the order discount', () => {
    const result = calculatePosStatutoryDiscountPreview({
      lines: [{ productId: 'meal', lineTotal: 0.10, taxCategory: 'vat_exempt' }],
      allocations: [
        { productId: 'meal', taxCategory: 'vat_exempt', eligibleGross: 0.03 },
        { productId: 'meal', taxCategory: 'vat_exempt', eligibleGross: 0.03 },
      ],
      subtotal: 0.10,
      vatRegistered: true,
      pricesVatInclusive: true,
      vatRate: 12,
    });

    expect(result.allocations.map((allocation) => allocation.discountAmount)).toEqual([0.01, 0.01]);
    expect(result.discountAmount).toBe(0.02);
  });
});
