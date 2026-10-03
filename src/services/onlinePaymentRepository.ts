import { supabase } from './supabaseClient';

export type PendingOnlinePaymentInput = {
  restaurantId: string;
  customerName: string;
  mobileNumber: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  deliveryBarangay: string;
  deliveryAddress: string;
  notes: string;
  isThirdPartyCourier?: boolean;
  items: Array<{ productId: string; quantity: number }>;
  redeemLoyalty?: boolean;
};

export type PendingOnlinePayment = {
  paymentId: string;
  referenceNumber: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type OnlinePaymentStatus = {
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  orderNumber: string | null;
  total: number;
};

export async function createPendingOnlinePayment(input: PendingOnlinePaymentInput): Promise<PendingOnlinePayment> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { data, error } = await supabase.rpc('create_pending_online_payment', {
    p_restaurant_id: input.restaurantId,
    p_customer_name: input.customerName,
    p_mobile_number: input.mobileNumber,
    p_order_type: input.orderType,
    p_delivery_barangay: input.deliveryBarangay || null,
    p_delivery_address: input.deliveryAddress || null,
    p_notes: input.notes,
    p_is_third_party_courier: input.isThirdPartyCourier ?? false,
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_redeem_loyalty: input.redeemLoyalty ?? false,
  });

  if (error) throw new Error(error.message || 'Unable to prepare online payment.');
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('The online payment could not be prepared. Please try again.');

  return {
    paymentId: row.payment_id,
    referenceNumber: row.reference_number,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
  };
}

export async function getOnlinePaymentStatus(referenceNumber: string): Promise<OnlinePaymentStatus> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { data, error } = await supabase.rpc('get_online_payment_status', {
    p_reference_number: referenceNumber,
  });

  if (error) throw new Error(error.message || 'Unable to check online payment status.');
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('Online payment not found.');

  return {
    status: row.status,
    orderNumber: row.order_number ?? null,
    total: Number(row.total),
  };
}
