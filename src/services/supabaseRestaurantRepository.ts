import { defaultRestaurant } from '../config/defaultRestaurant';
import type { RestaurantConfig, RestaurantOperatingHours, RestaurantStorefront, RestaurantTheme } from '../types/restaurant';
import type { RestaurantLookup, RestaurantRepository } from './restaurantService';
import { supabaseGet, supabaseRpc } from './supabaseClient';

type RestaurantRow = {
  id: string; slug: string; name: string; tagline: string; logo_url: string | null;
  location_text: string | null; contact_number: string | null; email: string | null;
  ordering_enabled: boolean; operating_hours: RestaurantOperatingHours | null;
};

type RestaurantDomainRow = RestaurantRow;
type WebsiteCustomizationRow = {
  restaurant_id: string;
  theme: Partial<RestaurantTheme> | null;
  storefront: Partial<RestaurantStorefront> | null;
};

function mergeStorefront(customization: WebsiteCustomizationRow | null): RestaurantStorefront {
  const custom = customization?.storefront;
  const base = defaultRestaurant.storefront;
  return {
    ...base,
    ...(custom ?? {}),
    hero: { ...base.hero, ...(custom?.hero ?? {}) },
    sections: { ...base.sections, ...(custom?.sections ?? {}) },
    footer: { ...base.footer, ...(custom?.footer ?? {}) }
  };
}

function mergeTheme(customization: WebsiteCustomizationRow | null): RestaurantTheme {
  const custom = customization?.theme;
  if (!custom) return defaultRestaurant.theme;
  return { ...defaultRestaurant.theme, ...custom, colors: { ...defaultRestaurant.theme.colors, ...(custom.colors ?? {}) } };
}

async function getWebsiteCustomization(restaurantId: string): Promise<{ theme: RestaurantTheme; storefront: RestaurantStorefront }> {
  const rows = await supabaseGet<WebsiteCustomizationRow>('restaurant_website_customizations', {
    select: 'restaurant_id,theme,storefront', restaurant_id: 'eq.' + restaurantId, limit: '1'
  });
  return {
    theme: mergeTheme(rows[0] ?? null),
    storefront: mergeStorefront(rows[0] ?? null)
  };
}

function toRestaurantConfig(restaurant: RestaurantRow, customization: { theme: RestaurantTheme; storefront: RestaurantStorefront }): RestaurantConfig {
  return { ...defaultRestaurant, id: restaurant.id, name: restaurant.name, tagline: restaurant.tagline,
    logoUrl: restaurant.logo_url ?? undefined, locationText: restaurant.location_text ?? undefined,
    contactNumber: restaurant.contact_number ?? undefined, email: restaurant.email ?? undefined,
    operatingHours: restaurant.operating_hours ?? undefined, orderingEnabled: restaurant.ordering_enabled !== false,
    theme: customization.theme, storefront: customization.storefront };
}

export class SupabaseRestaurantRepository implements RestaurantRepository {
  async getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    if (lookup.domain) return this.getRestaurantByDomain(lookup.domain);
    const baseQuery = { select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,ordering_enabled,operating_hours', is_active: 'eq.true', limit: '1' };
    const rows = lookup.slug
      ? await supabaseGet<RestaurantRow>('restaurants', { ...baseQuery, slug: 'eq.' + lookup.slug })
      : await supabaseGet<RestaurantRow>('restaurants', baseQuery);
    const restaurant = rows[0];
    if (!restaurant) return null;
    return toRestaurantConfig(restaurant, await getWebsiteCustomization(restaurant.id));
  }

  private async getRestaurantByDomain(domain: string): Promise<RestaurantConfig | null> {
    const hostname = domain.trim().toLowerCase();
    if (!hostname) return null;
    const rows = await supabaseRpc<RestaurantDomainRow>('resolve_restaurant_by_domain', { p_hostname: hostname });
    const restaurant = rows[0];
    if (!restaurant) {
      const configuredSlug = String(import.meta.env.VITE_RESTAURANT_SLUG ?? '').trim();
      if (!configuredSlug) return null;
      const fallbackRows = await supabaseGet<RestaurantRow>('restaurants', {
        select: 'id,slug,name,tagline,logo_url,location_text,contact_number,email,ordering_enabled,operating_hours',
        slug: 'eq.' + configuredSlug, is_active: 'eq.true', limit: '1'
      });
      const fallbackRestaurant = fallbackRows[0];
      if (!fallbackRestaurant) return null;
      return toRestaurantConfig(fallbackRestaurant, await getWebsiteCustomization(fallbackRestaurant.id));
    }
    return toRestaurantConfig(restaurant, await getWebsiteCustomization(restaurant.id));
  }
}