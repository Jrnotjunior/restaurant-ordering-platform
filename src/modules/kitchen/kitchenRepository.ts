import { getRestaurantOrders, updateOrderStatus, type RestaurantOrder, type RestaurantOrderStatus } from '../ordering/orderService';

export async function getKitchenOrders(restaurantId: string, branchId?: string | null): Promise<RestaurantOrder[]> {
  return getRestaurantOrders(restaurantId, branchId);
}

export async function updateKitchenOrderStatus(orderId: string, status: RestaurantOrderStatus): Promise<void> {
  await updateOrderStatus(orderId, status);
}
