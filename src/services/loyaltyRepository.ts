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

type WalkInCustomerRow = {
  customer_id: string;
  name: string;
  points_balance: number | string;
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

export async function getOrCreateWalkInCustomer(
  restaurantId: string,
  name: string,
): Promise<{ customerId: string; name: string; pointsBalance: number }> {
  const rows = await supabaseRpc<WalkInCustomerRow>('get_or_create_walk_in_customer', {
    p_restaurant_id: restaurantId,
    p_name: name.trim(),
  });

  const row = rows[0];
  if (!row) throw new Error('Unable to create the loyalty customer record.');

  return {
    customerId: row.customer_id,
    name: row.name,
    pointsBalance: Number(row.points_balance),
  };
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
