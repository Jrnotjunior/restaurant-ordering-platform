import { supabase, supabaseRpc } from './supabaseClient';

const BUCKET = 'product-images';
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function uploadProductImage(restaurantId: string, productId: string, file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Use a JPG, PNG, or WEBP image.');
  if (file.size > MAX_SIZE) throw new Error('Product images must be 5 MB or smaller.');

  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${restaurantId}/${productId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });

  if (error) throw new Error(error.message || 'Unable to upload product image.');
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function saveProductImage(productId: string, imageUrl: string) {
  await supabaseRpc('update_restaurant_product_image', {
    p_product_id: productId,
    p_image_url: imageUrl,
  });
}
