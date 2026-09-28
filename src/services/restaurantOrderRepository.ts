import { supabaseRpc } from './supabaseClient';

export type RestaurantOrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export type RestaurantOrder = {
  orderId: string;
  orderNumber: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  paymentMethod: 'cash' | 'gcash';
  status: RestaurantOrderStatus;
  total: number;
  createdAt: string;
  items: { id: string; productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

type Row = {
  order_id: string;
  order_number: string;
  order_type: RestaurantOrder['orderType'];
  payment_method: RestaurantOrder['paymentMethod'];
  status: RestaurantOrderStatus;
  total: number;
  created_at: string;
  items: RestaurantOrder['items'];
};

export async function getRestaurantOrders(restaurantId: string): Promise<RestaurantOrder[]> {
  const rows = await supabaseRpc<Row>('get_restaurant_orders', { p_restaurant_id: restaurantId });
  return rows.map((row) => ({ ...row, orderId: row.order_id, orderNumber: row.order_number, createdAt: row.created_at, total: Number(row.total), items: (row.items ?? []).map((item) => ({ ...item, unitPrice: Number(item.unitPrice ?? item.unit_price), lineTotal: Number(item.lineTotal ?? item.line_total) })) }));
}

export async function updateOrderStatus(orderId: string, status: RestaurantOrderStatus) {
  await supabaseRpc('update_order_status', { p_order_id: orderId, p_status: status });
}
