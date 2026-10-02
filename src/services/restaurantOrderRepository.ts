import { supabaseRpc } from './supabaseClient';

export type RestaurantOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type RestaurantPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type RestaurantOrder = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  pickupMethod: 'customer' | 'third_party_courier' | null;
  paymentMethod: 'cash' | 'gcash';
  paymentStatus: RestaurantPaymentStatus;
  status: RestaurantOrderStatus;
  total: number;
  shippingFee: number;
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
  order_type: RestaurantOrder['orderType'];
  payment_method: RestaurantOrder['paymentMethod'];
  pickup_method?: 'customer' | 'third_party_courier' | null;
  payment_status?: RestaurantPaymentStatus | null;
  status: RestaurantOrderStatus;
  total: number | string;
  shipping_fee?: number | string | null;
  created_at: string;
  items?: RawOrderItem[] | null;
};

export async function getRestaurantOrders(restaurantId: string): Promise<RestaurantOrder[]> {
  const rows = await supabaseRpc<Row>('get_restaurant_orders', { p_restaurant_id: restaurantId });

  return rows.map((row): RestaurantOrder => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    customerName: row.customer_name ?? '',
    orderType: row.order_type,
    pickupMethod: row.pickup_method ?? null,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status ?? 'pending',
    status: row.status,
    total: Number(row.total),
    shippingFee: Number(row.shipping_fee ?? 0),
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

export type PosDiscountType = 'senior' | 'pwd';

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
  if (!row) throw new Error('The discount could not be applied.');

  const discountAmount = Number(row.discount_amount);
  const beneficiaryCount = Number(row.beneficiary_count);
  const groupSizeResult = Number(row.group_size);

  return {
    orderId: row.order_id,
    groupSize: groupSizeResult,
    beneficiaryCount,
    discountAmount,
    total: Number(row.total),
    eligibleShare: Number(((discountAmount / 0.20) / beneficiaryCount).toFixed(2)),
  };
}
