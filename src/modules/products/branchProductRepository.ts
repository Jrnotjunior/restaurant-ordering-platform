import { supabase } from '../../services/supabaseClient';
import type { RestaurantProduct } from '../../types/menu';

export type BranchProductSetting = {
  productId: string;
  isAvailable: boolean;
  priceOverride: number | null;
};

type BranchProductSettingRow = {
  product_id: string;
  is_available: boolean;
  price_override: number | string | null;
};

export async function getBranchProductSettings(
  restaurantId: string,
  branchId: string,
): Promise<Record<string, BranchProductSetting>> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  if (!restaurantId || !branchId) return {};

  const { data, error } = await supabase
    .from('restaurant_branch_product_settings')
    .select('product_id,is_available,price_override')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId);

  if (error) throw new Error(`Unable to load branch product settings: ${error.message}`);
  return Object.fromEntries(((data ?? []) as BranchProductSettingRow[]).map((row) => [
    row.product_id,
    {
      productId: row.product_id,
      isAvailable: Boolean(row.is_available),
      priceOverride: row.price_override == null ? null : Number(row.price_override),
    } satisfies BranchProductSetting,
  ]));
}

export async function saveBranchProductSettings(values: {
  restaurantId: string;
  branchId: string;
  productId: string;
  isAvailable: boolean;
  priceOverride: number | null;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');
  const { error } = await supabase.rpc('set_restaurant_branch_product_settings', {
    p_restaurant_id: values.restaurantId,
    p_branch_id: values.branchId,
    p_product_id: values.productId,
    p_is_available: values.isAvailable,
    p_price_override: values.priceOverride,
  });
  if (error) throw new Error(`Unable to save branch product settings: ${error.message}`);

  const channel = supabase.channel(`restaurant-menu-changes:${values.restaurantId}`);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.send({
        type: 'broadcast',
        event: 'restaurant_menu_changed',
        payload: { productId: values.productId, branchId: values.branchId },
      }).then(() => {
        void supabase?.removeChannel(channel);
      });
    }
  });
}

export function applyBranchProductSetting(
  product: RestaurantProduct,
  setting?: BranchProductSetting,
): RestaurantProduct {
  return {
    ...product,
    isAvailable: product.isAvailable && (setting?.isAvailable ?? true),
    price: setting?.priceOverride ?? product.price,
  };
}
