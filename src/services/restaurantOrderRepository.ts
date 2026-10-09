// Compatibility re-exports. Callers should prefer the feature service modules.
export { getRestaurantOrders, updateOrderStatus } from '../modules/ordering/orderService';
export type { RestaurantOrder, RestaurantOrderStatus } from '../modules/ordering/orderService';
export { getRestaurantSales } from '../modules/sales/salesService';

// Legacy POS names retained for compatibility.
export {
  applyPosGroupDiscounts,
  getRestaurantTaxSettings,
  confirmPosCashPayment as confirmDineInPayment,
} from '../modules/pos/posService';
export type {
  PosDiscountBeneficiary,
  PosDiscountIdType,
  PosDiscountType,
  RestaurantTaxSettings,
} from '../modules/pos/posService';
