export {
  applyPosGroupDiscounts,
  confirmPosCashPayment,
  getPosOrderTaxSnapshot,
  getRestaurantTaxSettings,
  getCurrentCashierName,
} from './posRepository';

export type {
  PosOrderTaxSnapshot,
  PosDiscountBeneficiary,
  PosDiscountIdType,
  PosDiscountType,
  RestaurantTaxSettings,
} from './posRepository';
