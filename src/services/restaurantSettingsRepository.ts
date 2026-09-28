import { supabase } from './supabaseClient';

export type RestaurantDeliveryZone = {
  id: string;
  restaurantId: string;
  barangay: string;
  shippingFee: number;
  isSupported: boolean;
  outOfScopeMessage: string;
};

const DEFAULT_OUT_OF_SCOPE_MESSAGE = 'This area is outside our delivery coverage. If you want to proceed, please book your own courier like Lalamove or Grab Express.';

export async function getRestaurantShippingFee(restaurantId: string): Promise<number> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { data, error } = await supabase.from('restaurants').select('shipping_fee').eq('id', restaurantId).single();
  if (error) throw new Error(error.message);
  return Number(data?.shipping_fee ?? 0);
}

export async function updateRestaurantShippingFee(restaurantId: string, shippingFee: number): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { error } = await supabase.from('restaurants').update({ shipping_fee: shippingFee }).eq('id', restaurantId);
  if (error) throw new Error(error.message);
}

export async function getRestaurantDeliveryZones(restaurantId: string): Promise<RestaurantDeliveryZone[]> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { data, error } = await supabase
    .from('restaurant_delivery_zones')
    .select('id, restaurant_id, barangay, shipping_fee, is_supported, out_of_scope_message')
    .eq('restaurant_id', restaurantId)
    .order('barangay', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    barangay: row.barangay,
    shippingFee: Number(row.shipping_fee ?? 0),
    isSupported: Boolean(row.is_supported),
    outOfScopeMessage: row.out_of_scope_message || DEFAULT_OUT_OF_SCOPE_MESSAGE,
  }));
}

export async function upsertRestaurantDeliveryZone(
  restaurantId: string,
  zone: Pick<RestaurantDeliveryZone, 'id' | 'barangay' | 'shippingFee' | 'isSupported' | 'outOfScopeMessage'>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const payload = {
    ...(zone.id ? { id: zone.id } : {}),
    restaurant_id: restaurantId,
    barangay: zone.barangay.trim(),
    shipping_fee: zone.shippingFee,
    is_supported: zone.isSupported,
    out_of_scope_message: zone.outOfScopeMessage.trim() || DEFAULT_OUT_OF_SCOPE_MESSAGE,
  };
  const { error } = await supabase.from('restaurant_delivery_zones').upsert(payload, { onConflict: 'restaurant_id,barangay' });
  if (error) throw new Error(error.message);
}

export async function deleteRestaurantDeliveryZone(restaurantId: string, zoneId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { error } = await supabase.from('restaurant_delivery_zones').delete().eq('restaurant_id', restaurantId).eq('id', zoneId);
  if (error) throw new Error(error.message);
}

export { DEFAULT_OUT_OF_SCOPE_MESSAGE };
