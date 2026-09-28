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
};

export class SupabaseRestaurantRepository implements RestaurantRepository {
  async getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    const rows = await supabaseGet<RestaurantRow>('restaurants', {
      select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email',
      slug: `eq.${lookup.slug}`,
      is_active: 'eq.true',
      limit: '1'
    });

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
      email: restaurant.email ?? undefined
    };
  }
}
