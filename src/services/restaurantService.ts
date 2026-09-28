import type { RestaurantConfig } from '../types/restaurant';

export type RestaurantLookup = {
  slug: string;
};

/**
 * Temporary repository boundary for restaurant data.
 * Supabase access will be implemented behind this interface so UI components
 * do not depend directly on database queries.
 */
export interface RestaurantRepository {
  getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null>;
}

export class ConfigRestaurantRepository implements RestaurantRepository {
  constructor(private readonly restaurant: RestaurantConfig) {}

  async getRestaurant(_lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    return this.restaurant;
  }
}
