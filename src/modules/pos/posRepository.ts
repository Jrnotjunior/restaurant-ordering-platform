import { supabaseRpc } from '../../services/supabaseClient';
import type { PosDiscountType } from '../../types/discount';
export type { PosDiscountType };

export type RestaurantTaxSettings = {
  vatRegistered: boolean;
  pricesVatInclusive: boolean;
  vatRate: number;
};

export async function getRestaurantTaxSettings(restaurantId: string): Promise<RestaurantTaxSettings> {
  const rows = await supabaseRpc<{
    vat_registered: boolean;
    prices_vat_inclusive: boolean;
    vat_rate: number | string;
  }>('get_restaurant_tax_settings', { p_restaurant_id: restaurantId });
  const row = rows[0];
  if (!row) throw new Error('Restaurant tax settings were not found.');
  return {
    vatRegistered: Boolean(row.vat_registered),
    pricesVatInclusive: Boolean(row.prices_vat_inclusive),
    vatRate: Number(row.vat_rate ?? 0),
  };
}

export async function confirmPosCashPayment(orderId: string) {
  await supabaseRpc('confirm_dine_in_payment', { p_order_id: orderId });
}



export type PosDiscountIdType =
  | 'osca_id'
  | 'national_senior_id'
  | 'pwd_id'
  | 'passport'
  | 'other_government_id';

export type PosDiscountBeneficiary = {
  discountType: PosDiscountType;
  idType: PosDiscountIdType;
  idNumber: string;
  eligibleAmount: number;
  discountAmount: number;
};

export async function applyPosGroupDiscounts(
  orderId: string,
  groupSize: number,
  beneficiaries: Omit<PosDiscountBeneficiary, 'eligibleAmount' | 'discountAmount'>[],
) {
  const rows = await supabaseRpc<{
    order_id: string;
    group_size: number;
    beneficiary_count: number;
    discount_amount: number | string;
    gross_sales: number | string;
    vatable_sales: number | string;
    vat_amount: number | string;
    vat_exempt_sales: number | string;
    net_sales: number | string;
    total: number | string;
  }>('apply_pos_group_discounts', {
    p_order_id: orderId,
    p_group_size: groupSize,
    p_beneficiaries: beneficiaries.map((beneficiary) => ({
      discount_type: beneficiary.discountType,
      discount_id_type: beneficiary.idType,
      discount_id_number: beneficiary.idNumber.trim(),
    })),
  });

  const row = rows[0];
  if (!row) throw new Error('POS financials could not be finalized.');

  const discountAmount = Number(row.discount_amount);
  const beneficiaryCount = Number(row.beneficiary_count);
  const groupSizeResult = Number(row.group_size);

  return {
    orderId: row.order_id,
    groupSize: groupSizeResult,
    beneficiaryCount,
    discountAmount,
    grossSales: Number(row.gross_sales),
    vatableSales: Number(row.vatable_sales),
    vatAmount: Number(row.vat_amount),
    vatExemptSales: Number(row.vat_exempt_sales),
    netSales: Number(row.net_sales),
    total: Number(row.total),
    eligibleShare: beneficiaryCount > 0 ? Number(((discountAmount / 0.20) / beneficiaryCount).toFixed(2)) : 0,
  };
}
