export type PosTaxCategory = 'standard_rate' | 'vat_exempt' | 'zero_rated' | null;

export type PosTaxLine = {
  productId: string;
  lineTotal: number;
  taxCategory: PosTaxCategory;
};

export type PosEligibleLineAllocationInput = {
  productId: string;
  taxCategory: PosTaxCategory;
  eligibleGross: number;
};

export type PosStatutoryDiscountPreviewInput = {
  lines: PosTaxLine[];
  allocations: PosEligibleLineAllocationInput[];
  subtotal: number;
  deliveryFee?: number;
  vatRegistered: boolean;
  pricesVatInclusive: boolean;
  vatRate: number;
};

const money = (amount: number) =>
  Number((Number.isFinite(amount) ? amount : 0).toFixed(2));

/**
 * Operational POS preview only. The persisted statutory-discount tax snapshot
 * must remain requires_review until the applicable allocation rules are
 * approved; this helper does not certify a tax result or issue an invoice.
 */
export function calculatePosStatutoryDiscountPreview(input: PosStatutoryDiscountPreviewInput) {
  const {
    lines,
    allocations: allocationInputs,
    subtotal: rawSubtotal,
    deliveryFee: rawDeliveryFee = 0,
    vatRegistered,
    pricesVatInclusive,
    vatRate: rawVatRate,
  } = input;
  const subtotal = money(rawSubtotal);
  const deliveryFee = money(Math.max(rawDeliveryFee, 0));
  const vatRate = Number.isFinite(rawVatRate) ? Math.max(rawVatRate, 0) : 0;

  const allocations = allocationInputs.flatMap((allocation) => {
    const eligibleGross = money(allocation.eligibleGross);
    if (eligibleGross <= 0) return [];
    const eligibleNet = vatRegistered && pricesVatInclusive && allocation.taxCategory === 'standard_rate'
      ? money(eligibleGross / (1 + vatRate / 100))
      : eligibleGross;
    return [{
      ...allocation,
      eligibleGross,
      eligibleNet,
      discountAmount: money(eligibleNet * 0.20),
    }];
  });

  const discountAmount = money(allocations.reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const allocatedEligibleGross = money(allocations.reduce((sum, allocation) => sum + allocation.eligibleGross, 0));
  const eligibleStandardGross = money(allocations.filter((allocation) => allocation.taxCategory === 'standard_rate')
    .reduce((sum, allocation) => sum + allocation.eligibleGross, 0));
  const eligibleStandardNet = money(allocations.filter((allocation) => allocation.taxCategory === 'standard_rate')
    .reduce((sum, allocation) => sum + allocation.eligibleNet, 0));
  const eligibleStandardDiscount = money(allocations.filter((allocation) => allocation.taxCategory === 'standard_rate')
    .reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const eligibleExemptDiscount = money(allocations.filter((allocation) => allocation.taxCategory === 'vat_exempt')
    .reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const eligibleZeroRatedDiscount = money(allocations.filter((allocation) => allocation.taxCategory === 'zero_rated')
    .reduce((sum, allocation) => sum + allocation.discountAmount, 0));

  const allLinesClassified = lines.length > 0 && lines.every((line) => line.taxCategory !== null);
  const baseStandardNet = money(lines.reduce((sum, line) => {
    if (line.taxCategory !== 'standard_rate') return sum;
    return sum + (vatRegistered && pricesVatInclusive
      ? money(line.lineTotal / (1 + vatRate / 100))
      : line.lineTotal);
  }, 0));
  const baseVatExemptSales = money(lines.reduce((sum, line) =>
    sum + (line.taxCategory === 'vat_exempt' ? line.lineTotal : 0), 0));
  const baseZeroRatedSales = money(lines.reduce((sum, line) =>
    sum + (line.taxCategory === 'zero_rated' ? line.lineTotal : 0), 0));

  const vatableSales = vatRegistered
    ? Math.max(money((allLinesClassified
      ? baseStandardNet
      : (pricesVatInclusive ? money(subtotal / (1 + vatRate / 100)) : subtotal))
      - eligibleStandardNet), 0)
    : 0;
  const vatAmount = vatRegistered ? money(vatableSales * vatRate / 100) : 0;
  const vatExemptSales = vatRegistered
    ? Math.max(money(baseVatExemptSales - eligibleExemptDiscount
      + eligibleStandardNet - eligibleStandardDiscount), 0)
    : 0;
  const zeroRatedSales = vatRegistered
    ? Math.max(money(baseZeroRatedSales - eligibleZeroRatedDiscount), 0)
    : 0;
  const netSales = vatRegistered
    ? money(vatableSales + vatExemptSales + zeroRatedSales)
    : Math.max(money(subtotal - discountAmount), 0);

  const preLoyaltyTotal = vatRegistered
    ? (pricesVatInclusive
      ? Math.max(money(subtotal - Math.max(eligibleStandardGross - eligibleStandardNet, 0) - discountAmount), 0)
      : (allLinesClassified
        ? Math.max(money(netSales + vatAmount), 0)
        : Math.max(money(subtotal + vatAmount - eligibleStandardNet * vatRate / 100 - discountAmount), 0)))
    : Math.max(money(subtotal - discountAmount), 0);

  return {
    allocations,
    discountAmount,
    allocatedEligibleGross,
    eligibleStandardGross,
    eligibleStandardNet,
    eligibleStandardDiscount,
    eligibleExemptDiscount,
    eligibleZeroRatedDiscount,
    allLinesClassified,
    vatableSales,
    vatAmount,
    vatExemptSales,
    zeroRatedSales,
    netSales,
    preLoyaltyTotal,
    totalWithDeliveryFee: Math.max(money(preLoyaltyTotal + deliveryFee), 0),
  };
}
