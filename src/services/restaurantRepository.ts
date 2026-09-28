import type { RestaurantConfig } from '../types/restaurant';
import type { RestaurantLookup, RestaurantRepository } from './restaurantService';

export async function getRestaurant(
  repository: RestaurantRepository,
  lookup: RestaurantLookup
): Promise<RestaurantConfig | null> {
  return repository.getRestaurant(lookup);
}
