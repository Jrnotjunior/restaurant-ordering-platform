export {
  findCustomersByName,
  attachCustomerToOrder,
  getLoyaltyRedemptionSettings,
  redeemLoyaltyReward,
  getMyLoyaltyPoints,
  redeemLoyaltyRewardForPendingPayment,
} from './loyaltyRepository';

export type {
  LoyaltyCustomerSuggestion,
  LoyaltyRedemptionSettings,
} from './loyaltyRepository';
