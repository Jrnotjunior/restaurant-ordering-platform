import { supabase } from '../../services/supabaseClient';
import type { RestaurantBranch, RestaurantBranchDraft } from './branchTypes';

export async function listRestaurantBranches(restaurantId: string, includeInactive = false): Promise<RestaurantBranch[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!restaurantId) return [];
  let query = supabase
    .from('restaurant_branches')
    .select('id,restaurant_id,branch_code,name,store_address,restaurant_address,contact_number,is_active,is_default,ordering_enabled,operating_hours,delivery_location_latitude,delivery_location_longitude,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters,created_at,updated_at')
    .eq('restaurant_id', restaurantId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Unable to load restaurant branches.');
  return (data ?? []) as RestaurantBranch[];
}

export async function createRestaurantBranch(restaurantId: string, draft: RestaurantBranchDraft): Promise<RestaurantBranch> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('restaurant_branches')
    .insert({ restaurant_id: restaurantId, ...normalizeDraft(draft) })
    .select('id,restaurant_id,branch_code,name,store_address,restaurant_address,contact_number,is_active,is_default,ordering_enabled,operating_hours,delivery_location_latitude,delivery_location_longitude,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters,created_at,updated_at')
    .single();
  if (error) throw new Error(error.message || 'Unable to create branch.');
  return data as RestaurantBranch;
}

export async function updateRestaurantBranch(branchId: string, restaurantId: string, draft: RestaurantBranchDraft): Promise<RestaurantBranch> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('restaurant_branches')
    .update({ ...normalizeDraft(draft), updated_at: new Date().toISOString() })
    .eq('id', branchId)
    .eq('restaurant_id', restaurantId)
    .select('id,restaurant_id,branch_code,name,store_address,restaurant_address,contact_number,is_active,is_default,ordering_enabled,operating_hours,delivery_location_latitude,delivery_location_longitude,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters,created_at,updated_at')
    .single();
  if (error) throw new Error(error.message || 'Unable to save branch settings.');
  return data as RestaurantBranch;
}

export async function setDefaultRestaurantBranch(restaurantId: string, branchId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('set_default_restaurant_branch', {
    p_restaurant_id: restaurantId,
    p_branch_id: branchId,
  });
  if (error) throw new Error(error.message || 'Unable to set the default branch.');
}

function normalizeDraft(draft: RestaurantBranchDraft) {
  return {
    branch_code: draft.branch_code.trim().toUpperCase(),
    name: draft.name.trim(),
    store_address: draft.store_address.trim() || null,
    restaurant_address: draft.restaurant_address.trim() || null,
    contact_number: draft.contact_number.trim() || null,
    is_active: draft.is_active,
    ordering_enabled: draft.ordering_enabled,
    operating_hours: draft.operating_hours,
    delivery_location_latitude: draft.delivery_location_latitude,
    delivery_location_longitude: draft.delivery_location_longitude,
    delivery_base_fee: draft.delivery_base_fee,
    delivery_distance_increment_meters: draft.delivery_distance_increment_meters,
    delivery_fee_per_increment: draft.delivery_fee_per_increment,
    delivery_max_distance_meters: draft.delivery_max_distance_meters,
  };
}
