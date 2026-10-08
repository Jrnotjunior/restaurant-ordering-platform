import { supabaseRpc } from './supabaseClient';

export type RestaurantOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type RestaurantPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type RestaurantTaxSettings = {
  vatRegistered: boolean;
  pricesVatInclusive: boolean;
  vatRate: number;
};

export type RestaurantOrder = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  notes: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  pickupMethod: 'customer' | 'third_party_courier' | null;
  paymentMethod: 'cash' | 'gcash';
  paymentStatus: RestaurantPaymentStatus;
  paymongoPaymentId: string | null;
  paymongoCheckoutSessionId: string | null;
  paymongoPaymentMethod: string | null;
  paymongoFee: number | null;
  paymongoNetAmount: number | null;
  status: RestaurantOrderStatus;
  total: number;
  shippingFee: number;
  taxVatRegistered: boolean;
  taxPricesVatInclusive: boolean;
  taxVatRate: number;
  taxGrossSales: number;
  taxVatableSales: number;
  taxVatAmount: number;
  taxVatExemptSales: number;
  taxNetSales: number;
  discountAmount: number;
  loyaltyDiscountAmount: number;
  discountBeneficiaryCount: number;
  discountGroupSize: number;
  discountBeneficiaries: { discountType: PosDiscountType; idType: string; idNumber: string; eligibleAmount: number; discountAmount: number }[];
  createdAt: string;
  items: { id: string; productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

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

export async function getRestaurantOrders(restaurantId: string): Promise<RestaurantOrder[]> {
  const rows = await supabaseRpc<Row>('get_restaurant_orders', { p_restaurant_id: restaurantId });

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

export async function updateOrderStatus(orderId: string, status: RestaurantOrderStatus) {
  await supabaseRpc('update_order_status', { p_order_id: orderId, p_status: status });
}


}

