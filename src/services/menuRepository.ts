import type { RestaurantCategory, RestaurantProduct } from '../types/menu';
import { supabase, supabaseRpc } from './supabaseClient';

type CategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  image_url: string | null;
  sort_order: number;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

export async function getMenu(restaurantId: string, includeUnavailable = false): Promise<{ categories: RestaurantCategory[]; products: RestaurantProduct[] }> {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  let categoryQuery = supabase
    .from('categories')
    .select('id,restaurant_id,name,slug,description,sort_order,is_active,created_at,updated_at')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  let productQuery = supabase
    .from('products')
    .select('id,restaurant_id,category_id,name,slug,description,price,image_url,sort_order,is_available,created_at,updated_at')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (!includeUnavailable) {
    productQuery = productQuery.eq('is_available', true);
  }

  const [categoryResult, productResult] = await Promise.all([categoryQuery, productQuery]);

  if (categoryResult.error) {
    throw new Error(`Unable to load product categories: ${categoryResult.error.message}`);
  }

  if (productResult.error) {
    throw new Error(`Unable to load products: ${productResult.error.message}`);
  }

  const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
  const productRows = (productResult.data ?? []) as ProductRow[];
  const usedCategoryIds = new Set(productRows.map((product) => product.category_id));

  return {
    categories: categoryRows.filter((category) => usedCategoryIds.has(category.id)).map((category) => ({
      id: category.id,
      restaurantId: category.restaurant_id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sort_order,
      isActive: category.is_active,
      createdAt: category.created_at,
      updatedAt: category.updated_at
    })),
    products: productRows.map((product) => ({
      id: product.id,
      restaurantId: product.restaurant_id,
      categoryId: product.category_id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: Number(product.price),
      imageUrl: product.image_url ?? undefined,
      sortOrder: product.sort_order,
      isAvailable: product.is_available,
      createdAt: product.created_at,
      updatedAt: product.updated_at
    }))
  };
}

export async function getOrCreateCategory(restaurantId: string, name: string) {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Category is required.');

  const { data, error } = await supabase.rpc('get_or_create_restaurant_category', {
    p_restaurant_id: restaurantId,
    p_name: trimmedName
  });

  if (error) throw new Error(`Unable to save category: ${error.message}`);
  if (!data) throw new Error('Category was created but no category ID was returned.');
  return String(data);
}

export async function setProductAvailability(productId: string, isAvailable: boolean, restaurantId?: string) {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { error } = await supabase.rpc('update_product_availability', {
    p_product_id: productId,
    p_is_available: isAvailable
  });

  if (error) throw new Error(`Unable to update product availability: ${error.message}`);

  if (!restaurantId) return;

  const channel = supabase.channel(`restaurant-menu-changes:${restaurantId}`);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      void channel.send({
        type: 'broadcast',
        event: 'restaurant_menu_changed',
        payload: { productId, isAvailable },
      }).then(() => {
        void supabase?.removeChannel(channel);
      });
    }
  });
}

export async function createProduct(values: { restaurantId: string; name: string; description: string; price: number; categoryId: string }) {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { data, error } = await supabase.rpc('create_restaurant_product', {
    p_restaurant_id: values.restaurantId,
    p_name: values.name.trim(),
    p_description: values.description.trim(),
    p_price: values.price,
    p_category_id: values.categoryId
  });

  if (error) throw new Error(`Unable to create product: ${error.message}`);
  if (!data) throw new Error('Product was created but no product ID was returned.');
  return String(data);
}

export async function updateProduct(product: RestaurantProduct, values: { name: string; description: string; price: number; categoryId: string }) {
  if (!supabase) throw new Error('Supabase environment variables are not configured.');

  const { error } = await supabase.rpc('update_restaurant_product', {
    p_product_id: product.id,
    p_name: values.name.trim(),
    p_description: values.description.trim(),
    p_price: values.price,
    p_category_id: values.categoryId
  });

  if (error) throw new Error(`Unable to update product: ${error.message}`);
}

export async function deleteProduct(productId: string) {
  await supabaseRpc('delete_restaurant_product', { p_product_id: productId });
}
