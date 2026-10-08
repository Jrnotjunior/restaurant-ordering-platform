import { getRestaurantOrders, updateOrderStatus, type RestaurantOrder, type RestaurantOrderStatus } from '../../services/restaurantOrderRepository';

export async function getKitchenOrders(restaurantId: string): Promise<RestaurantOrder[]> {
  return getRestaurantOrders(restaurantId);
}

export async function updateKitchenOrderStatus(orderId: string, status: RestaurantOrderStatus): Promise<void> {
  await updateOrderStatus(orderId, status);
}
