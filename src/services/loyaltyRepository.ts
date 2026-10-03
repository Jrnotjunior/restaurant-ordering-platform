import { supabaseRpc } from './supabaseClient';

export type LoyaltyCustomerSuggestion = {
  customerId: string;
  name: string;
  phone: string | null;
  pointsBalance: number;
  isRegistered: boolean;
};

type LoyaltyCustomerSuggestionRow = {
  customer_id: string;
  name: string;
  phone: string | null;
  points_balance: number | string;
  is_registered: boolean;
};

export async function findCustomersByName(
  restaurantId: string,
  name: string,
): Promise<LoyaltyCustomerSuggestion[]> {
  const trimmedName = name.trim();
  if (trimmedName.length < 2) return [];

  const rows = await supabaseRpc<LoyaltyCustomerSuggestionRow>('find_customers_by_name', {
    p_restaurant_id: restaurantId,
    p_name: trimmedName,
  });

  return rows.map((row) => ({
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone ?? null,
    pointsBalance: Number(row.points_balance),
    isRegistered: Boolean(row.is_registered),
  }));
}

export async function attachCustomerToOrder(
  orderId: string,
  customerId: string,
): Promise<void> {
  await supabaseRpc('attach_customer_to_order', {
    p_order_id: orderId,
    p_customer_id: customerId,
  });
}


export type LoyaltyRedemptionSettings = {
  enabled: boolean;
  pointsRequired: number;
  discountAmount: number;
};

export async function getLoyaltyRedemptionSettings(restaurantId: string): Promise<LoyaltyRedemptionSettings> {
  const { supabase } = await import('./supabaseClient');
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('restaurants')
    .select('loyalty_redemption_enabled,loyalty_redemption_points,loyalty_redemption_amount')
    .eq('id', restaurantId)
    .single();

  if (error) throw error;

  return {
    enabled: Boolean(data?.loyalty_redemption_enabled),
    pointsRequired: Number(data?.loyalty_redemption_points ?? 50),
    discountAmount: Number(data?.loyalty_redemption_amount ?? 50),
  };
}

export async function redeemLoyaltyReward(
  orderId: string,
  customerId: string,
): Promise<{ pointsRedeemed: number; discountAmount: number; remainingPoints: number }> {
  const rows = await supabaseRpc<{
    points_redeemed: number | string;
    discount_amount: number | string;
    remaining_points: number | string;
  }>('redeem_loyalty_reward', {
    p_order_id: orderId,
    p_customer_id: customerId,
  });

  const row = rows[0];
  if (!row) throw new Error('Unable to redeem the loyalty reward.');

  return {
    pointsRedeemed: Number(row.points_redeemed),
    discountAmount: Number(row.discount_amount),
    remainingPoints: Number(row.remaining_points),
  };
}


export async function getMyLoyaltyPoints(restaurantId: string): Promise<number> {
  const rows = await supabaseRpc<number | string>('get_my_loyalty_points', {
    p_restaurant_id: restaurantId,
  });
  return Number(rows[0] ?? 0);
}

export async function redeemLoyaltyRewardForPendingPayment(
  paymentId: string,
): Promise<{ pointsRedeemed: number; discountAmount: number; total: number }> {
  const rows = await supabaseRpc<{
    points_redeemed: number | string;
    discount_amount: number | string;
    total: number | string;
  }>('redeem_loyalty_reward_for_pending_payment', {
    p_payment_id: paymentId,
  });
  const row = rows[0];
  if (!row) throw new Error('Unable to apply the loyalty reward.');
  return {
    pointsRedeemed: Number(row.points_redeemed),
    discountAmount: Number(row.discount_amount),
    total: Number(row.total),
  };
}


export async function getMyCustomerProfileId(restaurantId: string): Promise<string | null> {
  const rows = await supabaseRpc<string | null>('get_my_customer_profile_id', {
    p_restaurant_id: restaurantId,
  });
  return rows[0] ?? null;
}
