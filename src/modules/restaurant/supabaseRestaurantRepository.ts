import { defaultRestaurant } from '../../config/defaultRestaurant';
import type { RestaurantConfig, RestaurantOperatingHours, RestaurantStorefront, RestaurantTheme } from '../../types/restaurant';
import type { RestaurantLookup, RestaurantRepository } from './restaurantService';
import { supabaseGet, supabaseRpc } from '../../services/supabaseClient';

type RestaurantRow = {
  id: string; slug: string; name: string; tagline: string; logo_url: string | null;
  restaurant_address: string | null; contact_number: string | null; email: string | null;
  ordering_enabled: boolean; operating_hours: RestaurantOperatingHours | null;
};

type RestaurantDomainRow = RestaurantRow & {
  custom_domain?: string | null;
  branch_id?: string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  branch_store_address?: string | null;
  branch_restaurant_address?: string | null;
  branch_contact_number?: string | null;
  branch_ordering_enabled?: boolean;
  branch_operating_hours?: RestaurantOperatingHours | null;
};
type WebsiteCustomizationRow = {
  restaurant_id: string;
  branch_id?: string;
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
    socialLinks: { ...base.socialLinks, ...(custom?.socialLinks ?? {}) }
  };
}

function mergeTheme(customization: WebsiteCustomizationRow | null): RestaurantTheme {
  const custom = customization?.theme;
  if (!custom) return defaultRestaurant.theme;
  return { ...defaultRestaurant.theme, ...custom, colors: { ...defaultRestaurant.theme.colors, ...(custom.colors ?? {}) } };
}

async function getWebsiteCustomization(restaurantId: string, branchId?: string | null): Promise<{ theme: RestaurantTheme; storefront: RestaurantStorefront }> {
  if (branchId) {
    const branchRows = await supabaseGet<WebsiteCustomizationRow>('restaurant_branch_website_customizations', {
      select: 'restaurant_id,branch_id,theme,storefront',
      restaurant_id: 'eq.' + restaurantId,
      branch_id: 'eq.' + branchId,
      limit: '1'
    });
    if (branchRows[0]) {
      return {
        theme: mergeTheme(branchRows[0]),
        storefront: mergeStorefront(branchRows[0])
      };
    }
  }

  // Existing branches inherit business-wide settings until an owner saves their
  // independent branch customization.
  const rows = await supabaseGet<WebsiteCustomizationRow>('restaurant_website_customizations', {
    select: 'restaurant_id,theme,storefront', restaurant_id: 'eq.' + restaurantId, limit: '1'
  });
  return {
    theme: mergeTheme(rows[0] ?? null),
    storefront: mergeStorefront(rows[0] ?? null)
  };
}

function toRestaurantConfig(
  restaurant: RestaurantRow,
  customization: { theme: RestaurantTheme; storefront: RestaurantStorefront },
  storefrontBranchId?: string | null,
  branchContext?: RestaurantDomainRow,
): RestaurantConfig {
  return {
    ...defaultRestaurant,
    id: restaurant.id,
    storefrontBranchId: storefrontBranchId ?? undefined,
    name: restaurant.name,
    tagline: restaurant.tagline,
    logoUrl: restaurant.logo_url ?? undefined,
    locationText: branchContext?.branch_restaurant_address
      ?? branchContext?.branch_store_address
      ?? restaurant.restaurant_address
      ?? undefined,
    contactNumber: branchContext?.branch_contact_number ?? restaurant.contact_number ?? undefined,
    email: restaurant.email ?? undefined,
    operatingHours: branchContext?.branch_operating_hours ?? restaurant.operating_hours ?? undefined,
    orderingEnabled: restaurant.ordering_enabled !== false && branchContext?.branch_ordering_enabled !== false,
    theme: customization.theme,
    storefront: customization.storefront
  };
}

export class SupabaseRestaurantRepository implements RestaurantRepository {
  async getRestaurant(lookup: RestaurantLookup): Promise<RestaurantConfig | null> {
    if (lookup.domain) return this.getRestaurantByDomain(lookup.domain);
    const baseQuery = { select: 'id,slug,name,tagline,logo_url,restaurant_address,contact_number,email,ordering_enabled,operating_hours', is_active: 'eq.true', limit: '1' };
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
    const rows = await supabaseRpc<RestaurantDomainRow>('resolve_restaurant_branch_by_domain', { p_hostname: hostname });
    const restaurant = rows[0];
    if (!restaurant) {
      // The slug fallback is only for the temporary GitHub Pages test storefront.
      // Unknown custom domains must not silently resolve to a different tenant.
      if (hostname !== 'jrnotjunior.github.io') return null;
      const configuredSlug = String(import.meta.env.VITE_RESTAURANT_SLUG ?? '').trim();
      if (!configuredSlug) return null;
      const fallbackRows = await supabaseGet<RestaurantRow>('restaurants', {
        select: 'id,slug,name,tagline,logo_url,restaurant_address,contact_number,email,ordering_enabled,operating_hours',
        slug: 'eq.' + configuredSlug, is_active: 'eq.true', limit: '1'
      });
      const fallbackRestaurant = fallbackRows[0];
      if (!fallbackRestaurant) return null;
      return toRestaurantConfig(fallbackRestaurant, await getWebsiteCustomization(fallbackRestaurant.id));
    }
    return toRestaurantConfig(restaurant, await getWebsiteCustomization(restaurant.id, restaurant.branch_id), restaurant.branch_id, restaurant);
  }
}
