import type { RestaurantConfig } from '../types/restaurant';

export type RestaurantLookup = {
  slug: string;
};

export interface RestaurantRepository {
  getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null>;
}
