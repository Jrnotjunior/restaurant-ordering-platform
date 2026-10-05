import { supabase } from './supabaseClient';

export type RestaurantDeliveryZone = {
  id: string;
  restaurantId: string;
  city: string;
  barangay: string;
  shippingFee: number;
  isSupported: boolean;
  outOfScopeMessage: string;
};

const DEFAULT_OUT_OF_SCOPE_MESSAGE = 'This area is outside our delivery coverage. If you want to proceed, please book your own courier like Lalamove or Grab Express.';


export type RestaurantDeliverySettings = {
  deliveryEnabled: boolean;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryRadiusKm: number;
  deliveryFee: number;
  allowThirdPartyCourier: boolean;
};

export async function getRestaurantDeliverySettings(restaurantId: string): Promise<RestaurantDeliverySettings> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { data, error } = await supabase
    .from('restaurants')
    .select('delivery_enabled, delivery_latitude, delivery_longitude, delivery_radius_km, delivery_fee, allow_third_party_courier')
    .eq('id', restaurantId)
    .single();
  if (error) throw new Error(error.message);
  return {
    deliveryEnabled: data?.delivery_enabled !== false,
    deliveryLatitude: data?.delivery_latitude == null ? null : Number(data.delivery_latitude),
    deliveryLongitude: data?.delivery_longitude == null ? null : Number(data.delivery_longitude),
    deliveryRadiusKm: Number(data?.delivery_radius_km ?? 5),
    deliveryFee: Number(data?.delivery_fee ?? 0),
    allowThirdPartyCourier: data?.allow_third_party_courier !== false,
  };
}

export async function updateRestaurantDeliverySettings(
  restaurantId: string,
  settings: RestaurantDeliverySettings,
): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { error } = await supabase.rpc('update_restaurant_delivery_settings', {
    p_restaurant_id: restaurantId,
    p_delivery_enabled: settings.deliveryEnabled,
    p_delivery_latitude: settings.deliveryLatitude,
    p_delivery_longitude: settings.deliveryLongitude,
    p_delivery_radius_km: settings.deliveryRadiusKm,
    p_delivery_fee: settings.deliveryFee,
    p_allow_third_party_courier: settings.allowThirdPartyCourier,
  });
  if (error) throw new Error(error.message);
}

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
    .select('id, restaurant_id, city, barangay, shipping_fee, is_supported, out_of_scope_message')
    .eq('restaurant_id', restaurantId)
    .order('barangay', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    city: row.city,
    barangay: row.barangay,
    shippingFee: Number(row.shipping_fee ?? 0),
    isSupported: Boolean(row.is_supported),
    outOfScopeMessage: row.out_of_scope_message || DEFAULT_OUT_OF_SCOPE_MESSAGE,
  }));
}

export async function upsertRestaurantDeliveryZone(
  restaurantId: string,
  zone: Pick<RestaurantDeliveryZone, 'id' | 'city' | 'barangay' | 'shippingFee' | 'isSupported' | 'outOfScopeMessage'>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const payload = {
    ...(zone.id ? { id: zone.id } : {}),
    restaurant_id: restaurantId,
    city: zone.city.trim(),
    barangay: zone.barangay.trim(),
    shipping_fee: zone.shippingFee,
    is_supported: zone.isSupported,
    out_of_scope_message: zone.outOfScopeMessage.trim() || DEFAULT_OUT_OF_SCOPE_MESSAGE,
  };
  const { error } = await supabase.from('restaurant_delivery_zones').upsert(payload, { onConflict: 'restaurant_id,city,barangay' });
  if (error) throw new Error(error.message);
}

export async function deleteRestaurantDeliveryZone(restaurantId: string, zoneId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { error } = await supabase.from('restaurant_delivery_zones').delete().eq('restaurant_id', restaurantId).eq('id', zoneId);
  if (error) throw new Error(error.message);
}

export { DEFAULT_OUT_OF_SCOPE_MESSAGE };
