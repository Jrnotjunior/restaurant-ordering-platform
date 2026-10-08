import { supabaseRpc } from './supabaseClient';

export type RestaurantOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type RestaurantOrderDiscountType = 'senior' | 'pwd';
export type RestaurantPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

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
      discountType: (item.discountType ?? item.discount_type ?? 'senior') as RestaurantOrderDiscountType,
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

export async function updateOrderStatus(orderId: string, status: RestaurantOrderStatus) {
  await supabaseRpc('update_order_status', { p_order_id: orderId, p_status: status });
}

export async function confirmDineInPayment(orderId: string) {
  await supabaseRpc('confirm_dine_in_payment', { p_order_id: orderId });
}

