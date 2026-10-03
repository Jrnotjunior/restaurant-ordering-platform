import { defaultRestaurant } from '../config/defaultRestaurant';
import type { RestaurantConfig } from '../types/restaurant';
import type { RestaurantLookup, RestaurantRepository } from './restaurantService';
import { supabaseGet } from './supabaseClient';

type RestaurantRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logo_url: string | null;
  location_text: string | null;
  contact_number: string | null;
  email: string | null;
  ordering_enabled: boolean;
};

export class SupabaseRestaurantRepository implements RestaurantRepository {
  async getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    const baseQuery = {
      select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,ordering_enabled',
      is_active: 'eq.true',
      limit: '1'
    };

    const rows = lookup.slug
      ? await supabaseGet<RestaurantRow>('restaurants', {
          ...baseQuery,
          slug: `eq.${lookup.slug}`
        })
      : await supabaseGet<RestaurantRow>('restaurants', baseQuery);

    const restaurant = rows[0];

    if (!restaurant) {
      return null;
    }

    return {
      ...defaultRestaurant,
      id: restaurant.id,
      name: restaurant.name,
      tagline: restaurant.tagline,
      logoUrl: restaurant.logo_url ?? undefined,
      locationText: restaurant.location_text ?? undefined,
      contactNumber: restaurant.contact_number ?? undefined,
      email: restaurant.email ?? undefined,
      orderingEnabled: restaurant.ordering_enabled !== false
    };
  }
}
