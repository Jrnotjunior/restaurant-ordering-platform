import { supabase } from '../../services/supabaseClient';

export type DeliveryRouteQuote = {
  quoteId: string;
  expiresAt: string;
  distanceMeters: number;
  deliveryFee: number;
  maxDistanceMeters: number;
  inRange: boolean;
};

export async function calculateDeliveryRoute(
  restaurantId: string,
  latitude: number,
  longitude: number,
): Promise<DeliveryRouteQuote> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { data, error } = await supabase.functions.invoke('calculate-delivery-route', {
    body: { restaurantId, latitude, longitude },
  });
  if (error) throw new Error(error.message || 'Unable to calculate delivery distance.');
  if (!data?.quoteId) throw new Error(data?.error || 'Unable to calculate delivery distance.');
  return {
    quoteId: data.quoteId,
    expiresAt: data.expiresAt,
    distanceMeters: Number(data.distanceMeters),
    deliveryFee: Number(data.deliveryFee),
    maxDistanceMeters: Number(data.maxDistanceMeters),
    inRange: Boolean(data.inRange),
  };
}