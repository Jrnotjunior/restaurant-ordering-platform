import { supabase } from './supabaseClient';

export async function getRestaurantShippingFee(restaurantId: string): Promise<number> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { data, error } = await supabase
    .from('restaurants')
    .select('shipping_fee')
    .eq('id', restaurantId)
    .single();

  if (error) throw new Error(error.message);
  return Number(data?.shipping_fee ?? 0);
}

export async function updateRestaurantShippingFee(restaurantId: string, shippingFee: number): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { error } = await supabase
    .from('restaurants')
    .update({ shipping_fee: shippingFee })
    .eq('id', restaurantId);

  if (error) throw new Error(error.message);
}
