import { supabaseRpc } from '../../services/supabaseClient';

export type RestaurantLoyaltyCustomer = {
  customerId: string;
  name: string;
  email: string;
  phone: string | null;
  registeredAt: string;
  pointsBalance: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  lastActivityAt: string | null;
};

type RestaurantLoyaltyCustomerRow = {
  customer_id: string;
  customer_name: string;
  email: string;
  phone: string | null;
  registered_at: string;
  points_balance: number | string;
  lifetime_points_earned: number | string;
  lifetime_points_redeemed: number | string;
  last_activity_at: string | null;
};

export async function getRestaurantLoyaltyCustomers(
  restaurantId: string,
): Promise<RestaurantLoyaltyCustomer[]> {
  const rows = await supabaseRpc<RestaurantLoyaltyCustomerRow>(
    'get_restaurant_loyalty_customers',
    { p_restaurant_id: restaurantId },
  );

  return rows.map((row) => ({
    customerId: row.customer_id,
    name: row.customer_name,
    email: row.email,
    phone: row.phone ?? null,
    registeredAt: row.registered_at,
    pointsBalance: Number(row.points_balance ?? 0),
    lifetimePointsEarned: Number(row.lifetime_points_earned ?? 0),
    lifetimePointsRedeemed: Number(row.lifetime_points_redeemed ?? 0),
    lastActivityAt: row.last_activity_at ?? null,
  }));
}
