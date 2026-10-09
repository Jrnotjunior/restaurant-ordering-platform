import { supabase, supabaseRpc } from '../../services/supabaseClient';
import type { PosDiscountType } from '../../types/discount';
import type { RestaurantOrder, RestaurantPaymentStatus, RestaurantOrderStatus } from '../ordering/orderService';

type RawOrderItem = {
  id: string;
  productName?: string;
  product_name?: string;
  quantity: number;
  unitPrice?: number | string;
  unit_price?: number | string;
  lineTotal?: number | string;
  line_total?: number | string;
};

type Row = {
  order_id: string;
  order_number: string;
  customer_name?: string | null;
  notes?: string | null;
  order_type: RestaurantOrder['orderType'];
  payment_method: RestaurantOrder['paymentMethod'];
  pickup_method?: 'customer' | 'third_party_courier' | null;
  payment_status?: RestaurantPaymentStatus | null;
  paymongo_payment_id?: string | null;
  paymongo_checkout_session_id?: string | null;
  paymongo_payment_method?: string | null;
  paymongo_fee?: number | string | null;
  paymongo_net_amount?: number | string | null;
  status: RestaurantOrderStatus;
  total: number | string;
  shipping_fee?: number | string | null;
  created_at: string;
  items?: RawOrderItem[] | null;
  tax_vat_registered?: boolean | null;
  tax_prices_vat_inclusive?: boolean | null;
  tax_vat_rate?: number | string | null;
  tax_gross_sales?: number | string | null;
  tax_vatable_sales?: number | string | null;
  tax_vat_amount?: number | string | null;
  tax_vat_exempt_sales?: number | string | null;
  tax_net_sales?: number | string | null;
  discount_amount?: number | string | null;
  loyalty_discount_amount?: number | string | null;
  discount_beneficiary_count?: number | null;
  discount_group_size?: number | null;
  discount_beneficiaries?: { discountType?: string; discount_type?: string; idType?: string; discount_id_type?: string; idNumber?: string; discount_id_number?: string; eligibleAmount?: number | string; eligible_amount?: number | string; discountAmount?: number | string; discount_amount?: number | string }[] | null;
};

export async function getRestaurantSales(restaurantId: string): Promise<RestaurantOrder[]> {
  const rows = await supabaseRpc<Row>('get_restaurant_sales', { p_restaurant_id: restaurantId });

  return rows.map((row): RestaurantOrder => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name ?? '',
    notes: row.notes ?? '',
    orderType: row.order_type,
    pickupMethod: row.pickup_method ?? null,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status ?? 'pending',
    paymongoPaymentId: row.paymongo_payment_id ?? null,
    paymongoCheckoutSessionId: row.paymongo_checkout_session_id ?? null,
    paymongoPaymentMethod: row.paymongo_payment_method ?? null,
    paymongoFee: row.paymongo_fee == null ? null : Number(row.paymongo_fee),
    paymongoNetAmount: row.paymongo_net_amount == null ? null : Number(row.paymongo_net_amount),
    status: row.status,
    total: Number(row.total),
    shippingFee: Number(row.shipping_fee ?? 0),
    taxVatRegistered: Boolean(row.tax_vat_registered),
    taxPricesVatInclusive: Boolean(row.tax_prices_vat_inclusive),
    taxVatRate: Number(row.tax_vat_rate ?? 0),
    taxGrossSales: Number(row.tax_gross_sales ?? 0),
    taxVatableSales: Number(row.tax_vatable_sales ?? 0),
    taxVatAmount: Number(row.tax_vat_amount ?? 0),
    taxVatExemptSales: Number(row.tax_vat_exempt_sales ?? 0),
    taxNetSales: Number(row.tax_net_sales ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    loyaltyDiscountAmount: Number(row.loyalty_discount_amount ?? 0),
    discountBeneficiaryCount: Number(row.discount_beneficiary_count ?? 0),
    discountGroupSize: Number(row.discount_group_size ?? 1),
    discountBeneficiaries: (row.discount_beneficiaries ?? []).map((item) => ({
      discountType: (item.discountType ?? item.discount_type ?? 'senior') as PosDiscountType,
      idType: item.idType ?? item.discount_id_type ?? '',
      idNumber: item.idNumber ?? item.discount_id_number ?? '',
      eligibleAmount: Number(item.eligibleAmount ?? item.eligible_amount ?? 0),
      discountAmount: Number(item.discountAmount ?? item.discount_amount ?? 0),
    })),
    createdAt: row.created_at,
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      productName: item.productName ?? item.product_name ?? '',
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0),
      lineTotal: Number(item.lineTotal ?? item.line_total ?? 0),
    })),
  }));
}


export function subscribeToRestaurantSalesChanges(
  restaurantId: string,
  onChange: () => void,
  onStatusChange: (status: string) => void,
): (() => void) | null {
  if (!supabase) return null;

  const channel = supabase
    .channel(`restaurant-sales:${restaurantId}`)
    .on('broadcast', { event: 'restaurant_order_changed' }, onChange)
    .subscribe((status) => onStatusChange(status));

  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}
