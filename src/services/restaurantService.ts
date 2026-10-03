import type { RestaurantConfig } from '../types/restaurant';

export type RestaurantLookup = {
  slug?: string;
  domain?: string;
};

export interface RestaurantRepository {
  getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null>;
}

export class ConfigRestaurantRepository implements RestaurantRepository {
  constructor(private readonly config: RestaurantConfig) {}

  async getRestaurant(_lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    return this.config;
  }
}
