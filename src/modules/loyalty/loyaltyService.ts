export {
  findCustomersByName,
  attachCustomerToOrder,
  getLoyaltyRedemptionSettings,
  redeemLoyaltyReward,
  getMyLoyaltyPoints,
  redeemLoyaltyRewardForPendingPayment,
  getLoyaltyProgramSettings,
  saveLoyaltyProgramSettings,
} from './loyaltyRepository';

export type {
  LoyaltyCustomerSuggestion,
  LoyaltyRedemptionSettings,
} from './loyaltyRepository';
