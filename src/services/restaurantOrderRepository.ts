import { supabaseRpc } from './supabaseClient';
import type { RestaurantOrderStatus } from '../modules/ordering/orderRepository';

export { getRestaurantOrders, updateOrderStatus } from '../modules/ordering/orderRepository';
export type { RestaurantOrder, RestaurantOrderStatus } from '../modules/ordering/orderRepository';
export { getRestaurantSales } from '../modules/sales/salesRepository';


// Compatibility exports: POS operations now live in the POS module.
export {
  applyPosGroupDiscounts,
  getRestaurantTaxSettings,
  confirmPosCashPayment as confirmDineInPayment,
} from '../modules/pos/posRepository';
export type {
  PosDiscountBeneficiary,
  PosDiscountIdType,
  PosDiscountType,
  RestaurantTaxSettings,
} from '../modules/pos/posRepository';
