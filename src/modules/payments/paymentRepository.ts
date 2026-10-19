import { supabase } from '../../services/supabaseClient';
import {
  createGuestOrderCancellationToken,
  linkGuestOrderCancellationTokenToOrder,
  saveGuestOrderCancellationToken,
} from '../ordering/orderRepository';

export type PendingOnlinePaymentInput = {
  restaurantId: string;
  branchId?: string;
  customerName: string;
  mobileNumber: string;
  orderType: 'delivery' | 'take_out' | 'pickup' | 'dine_in';
  deliveryCity: string;
  deliveryBarangay: string;
  deliveryAddress: string;
  notes: string;
  isThirdPartyCourier?: boolean;
  customerDeliveryAddress?: string;
  customerDeliveryCity?: string;
  customerDeliveryBarangay?: string;
  customerDeliveryLatitude?: number;
  customerDeliveryLongitude?: number;
  customerDeliveryPlaceId?: string;
  deliveryQuoteId?: string;
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
  orderId: string | null;
  total: number;
};

export async function createPendingOnlinePayment(input: PendingOnlinePaymentInput): Promise<PendingOnlinePayment> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const guestCancelToken = await createGuestOrderCancellationToken();
  const rpcName = input.orderType === 'delivery' && !input.isThirdPartyCourier
    ? 'create_pending_online_payment_from_delivery_quote_with_guest_cancel_token'
    : 'create_pending_online_payment_with_guest_cancel_token';

  const rpcParams = input.orderType === 'delivery' && !input.isThirdPartyCourier
    ? {
        p_restaurant_id: input.restaurantId,
        p_customer_name: input.customerName,
        p_mobile_number: input.mobileNumber,
        p_delivery_city: input.deliveryCity || null,
        p_delivery_barangay: input.deliveryBarangay || null,
        p_delivery_address: input.deliveryAddress || null,
        p_notes: input.notes,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_redeem_loyalty: input.redeemLoyalty ?? false,
        p_customer_delivery_address: input.customerDeliveryAddress || null,
        p_customer_delivery_city: input.customerDeliveryCity || null,
        p_customer_delivery_barangay: input.customerDeliveryBarangay || null,
        p_customer_delivery_latitude: input.customerDeliveryLatitude ?? null,
        p_customer_delivery_longitude: input.customerDeliveryLongitude ?? null,
        p_customer_delivery_place_id: input.customerDeliveryPlaceId || null,
        p_delivery_quote_id: input.deliveryQuoteId || null,
        p_guest_cancel_token_hash: guestCancelToken.tokenHash,
        ...(input.branchId ? { p_branch_id: input.branchId } : {}),
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
        p_is_third_party_courier: input.isThirdPartyCourier ?? false,
        p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
        p_redeem_loyalty: input.redeemLoyalty ?? false,
        p_customer_delivery_address: input.customerDeliveryAddress || null,
        p_customer_delivery_city: input.customerDeliveryCity || null,
        p_customer_delivery_barangay: input.customerDeliveryBarangay || null,
        p_customer_delivery_latitude: input.customerDeliveryLatitude ?? null,
        p_customer_delivery_longitude: input.customerDeliveryLongitude ?? null,
        p_customer_delivery_place_id: input.customerDeliveryPlaceId || null,
        p_guest_cancel_token_hash: guestCancelToken.tokenHash,
        ...(input.branchId ? { p_branch_id: input.branchId } : {}),
      };

  const { data, error } = await supabase.rpc(rpcName, rpcParams);

  if (error) throw new Error(error.message || 'Unable to prepare online payment.');
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error('The online payment could not be prepared. Please try again.');

  // Keep the raw token in this browser under the payment reference while the
  // customer is redirected to PayMongo. Only its hash is stored server-side.
  saveGuestOrderCancellationToken(`payment:${row.reference_number}`, guestCancelToken.token);

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

  const orderId = row.order_id ?? null;
  if (row.status === 'paid' && orderId) {
    linkGuestOrderCancellationTokenToOrder(referenceNumber, orderId);
  }

  return {
    status: row.status,
    orderNumber: row.order_number ?? null,
    orderId,
    total: Number(row.total),
  };
}
