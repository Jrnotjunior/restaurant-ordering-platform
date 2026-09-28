import { supabaseRpc } from './supabaseClient';

type CreateOrderItem = {
  productId: string;
  quantity: number;
};

export type CreateOrderInput = {
  restaurantId: string;
  customerName: string;
  mobileNumber: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  tableNumber: string;
  deliveryAddress: string;
  notes: string;
  paymentMethod: 'cash' | 'gcash';
  items: CreateOrderItem[];
};

export type CreatedOrder = {
  orderId: string;
  orderNumber: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
};

type CreatedOrderRow = {
  order_id: string;
  order_number: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
};

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const rows = await supabaseRpc<CreatedOrderRow>('create_order', {
    p_restaurant_id: input.restaurantId,
    p_customer_name: input.customerName,
    p_mobile_number: input.mobileNumber,
    p_order_type: input.orderType,
    p_table_number: input.tableNumber || null,
    p_delivery_address: input.deliveryAddress || null,
    p_notes: input.notes,
    p_payment_method: input.paymentMethod,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  });

  const row = rows[0];
  if (!row) {
    throw new Error('The order could not be created. Please try again.');
  }

  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
  };
}
