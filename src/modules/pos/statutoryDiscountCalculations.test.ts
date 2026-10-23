import { describe, expect, it } from 'vitest';
import { allocatePosEqualGroupShares, calculatePosStatutoryDiscountPreview } from './statutoryDiscountCalculations';

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
    expect(result.totalWithDeliveryFee).toBeCloseTo(
      result.vatableSales + result.vatAmount + result.vatExemptSales + result.zeroRatedSales + 12,
      2,
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
    expect(result.totalWithDeliveryFee).toBeCloseTo(
      result.vatableSales + result.vatAmount + result.vatExemptSales + result.zeroRatedSales + 12,
      2,
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

describe('allocatePosEqualGroupShares', () => {
  it('splits an order across customers and applies allocations only to the beneficiary', () => {
    const lines = [
      { productId: 'bowl', lineTotal: 180, taxCategory: 'standard_rate' as const },
      { productId: 'cookie', lineTotal: 130, taxCategory: 'vat_exempt' as const },
      { productId: 'pasta', lineTotal: 150, taxCategory: 'standard_rate' as const },
    ];

    const [seniorShare] = allocatePosEqualGroupShares(lines, 2, 1);

    expect(seniorShare.reduce((sum, line) => sum + line.eligibleGross, 0)).toBe(230);
    expect(seniorShare.map((line) => line.eligibleGross)).toEqual([90, 65, 75]);
  });

  it('keeps every line allocation within the line total when all group members qualify', () => {
    const lines = [
      { productId: 'one', lineTotal: 10.01, taxCategory: 'vat_exempt' as const },
      { productId: 'two', lineTotal: 8.02, taxCategory: 'zero_rated' as const },
      { productId: 'three', lineTotal: 4.99, taxCategory: 'standard_rate' as const },
    ];

    const shares = allocatePosEqualGroupShares(lines, 3, 3);
    expect(shares).toHaveLength(3);

    for (const line of lines) {
      const totalAllocated = shares.reduce((sum, share) => sum + (
        share.find((allocation) => allocation.productId === line.productId)?.eligibleGross ?? 0
      ), 0);
      expect(totalAllocated).toBeCloseTo(line.lineTotal, 2);
    }

    const grossShares = shares.map((share) =>
      share.reduce((sum, allocation) => sum + allocation.eligibleGross, 0),
    );
    expect(Math.max(...grossShares) - Math.min(...grossShares)).toBeLessThanOrEqual(0.01);
  });

  it('splits an order of ten people to one registered beneficiary without manual line amounts', () => {
    const lines = [
      { productId: 'rice', lineTotal: 600, taxCategory: 'standard_rate' as const },
      { productId: 'meal', lineTotal: 910, taxCategory: 'standard_rate' as const },
    ];

    const [beneficiaryShare] = allocatePosEqualGroupShares(lines, 10, 1);
    expect(beneficiaryShare.reduce((sum, line) => sum + line.eligibleGross, 0)).toBe(151);
    expect(beneficiaryShare.every((line) => line.eligibleGross <= (
      lines.find((item) => item.productId === line.productId)?.lineTotal ?? 0
    ))).toBe(true);
  });

  it('allocates the complete line value when there is one customer and one beneficiary', () => {
    const lines = [
      { productId: 'meal', lineTotal: 180, taxCategory: 'standard_rate' as const },
      { productId: 'drink', lineTotal: 50, taxCategory: 'vat_exempt' as const },
    ];

    expect(allocatePosEqualGroupShares(lines, 1, 1)[0]).toEqual([
      { productId: 'meal', taxCategory: 'standard_rate', eligibleGross: 180 },
      { productId: 'drink', taxCategory: 'vat_exempt', eligibleGross: 50 },
    ]);
  });
});
