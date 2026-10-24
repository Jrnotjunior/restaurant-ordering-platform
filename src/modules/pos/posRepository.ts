import { supabase, supabaseRpc } from '../../services/supabaseClient';
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

export type PosOrderTaxSnapshot = {
  order_id: string;
  tax_snapshot_status: 'legacy_unknown' | 'not_calculated' | 'calculated' | 'requires_review' | null;
  tax_snapshot_version: number | null;
  tax_vat_registered: boolean;
  tax_prices_vat_inclusive: boolean;
  tax_vat_rate: number | string | null;
  tax_gross_sales: number | string | null;
  tax_vatable_sales: number | string | null;
  tax_vat_amount: number | string | null;
  tax_vat_exempt_sales: number | string | null;
  tax_zero_rated_sales: number | string | null;
  tax_net_sales: number | string | null;
  tax_percentage_taxable_sales: number | string | null;
  tax_non_vat_exempt_sales: number | string | null;
  discount_amount: number | string;
  loyalty_discount_amount: number | string | null;
  discount_beneficiary_count: number;
  delivery_fee: number | string;
  total: number | string;
};

export async function getPosOrderTaxSnapshot(orderId: string): Promise<PosOrderTaxSnapshot | null> {
  const rows = await supabaseRpc<PosOrderTaxSnapshot>('get_pos_order_tax_snapshot', {
    p_order_id: orderId,
  });
  return rows[0] ?? null;
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
  beneficiaryName: string;
  beneficiaryTin: string;
  beneficiaryAddress: string;
  eligibleAmount: number;
  discountAmount: number;
  eligibleLines: { productId: string; eligibleAmount: number }[];
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
      beneficiary_name: beneficiary.beneficiaryName.trim(),
      beneficiary_tin: beneficiary.beneficiaryTin.trim() || null,
      beneficiary_address: beneficiary.beneficiaryAddress.trim(),
      eligible_lines: beneficiary.eligibleLines
        .map((line) => ({
          product_id: line.productId,
          eligible_amount: Number(line.eligibleAmount.toFixed(2)),
        }))
        .filter((line) => Number.isFinite(line.eligible_amount) && line.eligible_amount > 0),
    })),
  });

  const row = rows[0];
  if (!row) throw new Error('POS financials could not be finalized.');

  const discountAmount = Number(row.discount_amount);
  const beneficiaryCount = Number(row.beneficiary_count);
  const groupSizeResult = Number(row.group_size);
  let beneficiaryBreakdown: { idNumber: string; eligibleAmount: number; discountAmount: number }[] = [];

  // The server is authoritative for each beneficiary's VAT-exclusive eligible
  // amount and rounded discount. This read is optional for workflow completion;
  // the persisted allocation remains available for later reconciliation.
  if (supabase && beneficiaryCount > 0) {
    try {
      const { data } = await supabase
        .from('order_discount_beneficiaries')
        .select('discount_id_number,eligible_amount,discount_amount')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (data) {
        beneficiaryBreakdown = data.map((item) => ({
          idNumber: String(item.discount_id_number ?? ''),
          eligibleAmount: Number(item.eligible_amount ?? 0),
          discountAmount: Number(item.discount_amount ?? 0),
        }));
      }
    } catch {
      // Do not turn a successfully applied discount into a failed payment flow.
    }
  }

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
    beneficiaryBreakdown,
  };
}


export async function getCurrentCashierName(restaurantId: string): Promise<string> {
  if (!supabase) return 'Cashier';

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return 'Cashier';

    const { data, error } = await supabase
      .from('restaurant_staff')
      .select('preferred_name,name')
      .eq('restaurant_id', restaurantId)
      .eq('auth_user_id', userId)
      .eq('role', 'cashier')
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    return data?.preferred_name?.trim() || data?.name?.trim() || 'Cashier';
  } catch {
    return 'Cashier';
  }
}
