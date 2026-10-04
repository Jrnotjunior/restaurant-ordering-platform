import { defaultRestaurant } from '../config/defaultRestaurant';
import type { RestaurantConfig, RestaurantOperatingHours } from '../types/restaurant';
import type { RestaurantLookup, RestaurantRepository } from './restaurantService';
import { supabaseGet, supabaseRpc } from './supabaseClient';

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
  operating_hours: RestaurantOperatingHours | null;
};

type RestaurantDomainRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logo_url: string | null;
  location_text: string | null;
  contact_number: string | null;
  email: string | null;
  operating_hours: RestaurantOperatingHours | null;
  ordering_enabled: boolean;
};

export class SupabaseRestaurantRepository implements RestaurantRepository {
  async getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    if (lookup.domain) {
      return this.getRestaurantByDomain(lookup.domain);
    }
    const baseQuery = {
      select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,ordering_enabled,operating_hours',
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
      operatingHours: restaurant.operating_hours ?? undefined,
      orderingEnabled: restaurant.ordering_enabled !== false
    };
  }

  private async getRestaurantByDomain(domain: string): Promise<RestaurantConfig | null> {
    const hostname = domain.trim().toLowerCase();
    if (!hostname) return null;

    const rows = await supabaseRpc<RestaurantDomainRow>('resolve_restaurant_by_domain', {
      p_hostname: hostname
    });

    const restaurant = rows[0];
    if (!restaurant) return null;

    return {
      ...defaultRestaurant,
      id: restaurant.id,
      name: restaurant.name,
      tagline: restaurant.tagline,
      logoUrl: restaurant.logo_url ?? undefined,
      locationText: restaurant.location_text ?? undefined,
      contactNumber: restaurant.contact_number ?? undefined,
      email: restaurant.email ?? undefined,
      operatingHours: restaurant.operating_hours ?? undefined,
      orderingEnabled: restaurant.ordering_enabled !== false
    };
  }
}
