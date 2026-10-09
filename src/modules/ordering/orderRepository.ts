import { supabase, supabaseRpc } from '../../services/supabaseClient';
import type { PosDiscountType } from '../../types/discount';

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




type CreateOrderItem = {
  productId: string;
  quantity: number;
};

export type CreateOrderInput = {
  restaurantId: string;
  customerName: string;
  mobileNumber: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  deliveryCity: string;
  deliveryBarangay: string;
  deliveryAddress: string;
  notes: string;
  paymentMethod: 'cash' | 'gcash';
  isThirdPartyCourier?: boolean;
  customerDeliveryAddress?: string;
  customerDeliveryCity?: string;
  customerDeliveryBarangay?: string;
  customerDeliveryLatitude?: number;
  customerDeliveryLongitude?: number;
  customerDeliveryPlaceId?: string;
  deliveryQuoteId?: string;
  items: CreateOrderItem[];
};

export type CreatedOrder = {
  orderId: string;
  orderNumber: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type DeliveryStatus = 'assigned' | 'delivering' | 'out_for_delivery' | 'arrived' | 'delivered' | 'failed';

export type TrackedOrder = {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  restaurantName: string;
  storeAddress: string | null;
  operatingHours: Record<string, { isOpen: boolean; open: string; close: string }> | null;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  pickupMethod: 'customer' | 'third_party_courier' | null;
  paymentMethod: 'cash' | 'gcash';
  status: OrderStatus;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  total: number;
  subtotal: number;
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
  items: { id: string; productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
  deliveryStatus: DeliveryStatus | null;
  riderName: string | null;
  riderPhone: string | null;
  deliveryFailureReason: string | null;
};

type CreatedOrderRow = {
  order_id: string;
  order_number: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
};

type TrackedOrderRow = {
  order_id: string;
  order_number: string;
  restaurant_id: string;
  restaurant_name: string;
  store_address?: string | null;
  operating_hours?: TrackedOrder['operatingHours'];
  order_type: TrackedOrder['orderType'];
  pickup_method?: TrackedOrder['pickupMethod'];
  payment_method: TrackedOrder['paymentMethod'];
  status: OrderStatus;
  payment_status: TrackedOrder['paymentStatus'];
  total: number;
  subtotal: number | string;
  shipping_fee: number | string;
  tax_vat_registered: boolean;
  tax_prices_vat_inclusive: boolean;
  tax_vat_rate: number | string;
  tax_gross_sales: number | string;
  tax_vatable_sales: number | string;
  tax_vat_amount: number | string;
  tax_vat_exempt_sales: number | string;
  tax_net_sales: number | string;
  discount_amount: number | string;
  loyalty_discount_amount: number | string;
  items: { id: string; productName: string; quantity: number; unitPrice: number | string; lineTotal: number | string }[] | null;
  delivery_status?: DeliveryStatus | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  delivery_failure_reason?: string | null;
};

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const rpcName = input.orderType === 'delivery' && !input.isThirdPartyCourier
    ? 'create_order_from_delivery_quote'
    : 'create_order';

  const rpcParams = input.orderType === 'delivery' && !input.isThirdPartyCourier
    ? {
        p_restaurant_id: input.restaurantId,
        p_customer_name: input.customerName,
        p_mobile_number: input.mobileNumber,
        p_delivery_city: input.deliveryCity || null,
        p_delivery_barangay: input.deliveryBarangay || null,
        p_delivery_address: input.deliveryAddress || null,
        p_notes: input.notes,
        p_payment_method: input.paymentMethod,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_customer_delivery_address: input.customerDeliveryAddress || null,
        p_customer_delivery_city: input.customerDeliveryCity || null,
        p_customer_delivery_barangay: input.customerDeliveryBarangay || null,
        p_customer_delivery_latitude: input.customerDeliveryLatitude ?? null,
        p_customer_delivery_longitude: input.customerDeliveryLongitude ?? null,
        p_customer_delivery_place_id: input.customerDeliveryPlaceId || null,
        p_delivery_quote_id: input.deliveryQuoteId || null,
      }
    : {
        p_restaurant_id: input.restaurantId,
        p_customer_name: input.customerName,
        p_mobile_number: input.mobileNumber,
        p_order_type: input.orderType,
        p_delivery_city: input.deliveryCity || null,
        p_delivery_barangay: input.deliveryBarangay || null,
        p_delivery_address: input.deliveryAddress || null,
        p_notes: input.notes,
        p_payment_method: input.paymentMethod,
        p_is_third_party_courier: input.isThirdPartyCourier ?? false,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_customer_delivery_address: input.customerDeliveryAddress || null,
        p_customer_delivery_city: input.customerDeliveryCity || null,
        p_customer_delivery_barangay: input.customerDeliveryBarangay || null,
        p_customer_delivery_latitude: input.customerDeliveryLatitude ?? null,
        p_customer_delivery_longitude: input.customerDeliveryLongitude ?? null,
        p_customer_delivery_place_id: input.customerDeliveryPlaceId || null,
      };

  const rows = await supabaseRpc<CreatedOrderRow>(rpcName, rpcParams);

  const row = rows[0];
  if (!row) throw new Error('The order could not be created. Please try again.');

  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
  };
}

export async function getOrderStatus(orderId: string): Promise<TrackedOrder> {
  const rows = await supabaseRpc<TrackedOrderRow>('get_order_status_by_id', {
    p_order_id: orderId,
  });

  const row = rows[0];
  if (!row) throw new Error('Order not found. Please check the order number.');

  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    storeAddress: row.store_address ?? null,
    operatingHours: row.operating_hours ?? null,
    orderType: row.order_type,
    pickupMethod: row.pickup_method ?? null,
    paymentMethod: row.payment_method,
    status: row.status,
    paymentStatus: row.payment_status,
    total: Number(row.total),
    subtotal: Number(row.subtotal),
    shippingFee: Number(row.shipping_fee),
    taxVatRegistered: Boolean(row.tax_vat_registered),
    taxPricesVatInclusive: Boolean(row.tax_prices_vat_inclusive),
    taxVatRate: Number(row.tax_vat_rate),
    taxGrossSales: Number(row.tax_gross_sales),
    taxVatableSales: Number(row.tax_vatable_sales),
    taxVatAmount: Number(row.tax_vat_amount),
    taxVatExemptSales: Number(row.tax_vat_exempt_sales),
    taxNetSales: Number(row.tax_net_sales),
    discountAmount: Number(row.discount_amount),
    loyaltyDiscountAmount: Number(row.loyalty_discount_amount),
    items: (row.items ?? []).map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
    deliveryStatus: row.delivery_status ?? null,
    riderName: row.rider_name ?? null,
    riderPhone: row.rider_phone ?? null,
    deliveryFailureReason: row.delivery_failure_reason ?? null,
  };
}

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


export async function updateOrderStatus(orderId: string, status: RestaurantOrderStatus) {
  await supabaseRpc('update_order_status', { p_order_id: orderId, p_status: status });
}

export async function cancelMyPendingOrder(orderId: string) {
  await supabaseRpc('cancel_my_pending_order', { p_order_id: orderId });
}




export function subscribeToOrderTrackingChanges(
  orderId: string,
  onChange: () => void,
  onStatusChange: (status: string) => void,
): (() => void) | null {
  if (!supabase) return null;

  const channel = supabase
    .channel(`customer-order:${orderId}`)
    .on(
      'broadcast',
      { event: 'customer_order_changed' },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      },
      () => onChange(),
    )
    .subscribe((status) => onStatusChange(status));

  return () => {
    if (supabase) void supabase.removeChannel(channel);
  };
}
