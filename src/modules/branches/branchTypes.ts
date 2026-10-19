export type BranchDayHours = { isOpen: boolean; open: string; close: string };
export type BranchOperatingHours = Record<string, BranchDayHours>;

export type RestaurantBranch = {
  id: string;
  restaurant_id: string;
  branch_code: string;
  name: string;
  store_address: string | null;
  restaurant_address: string | null;
  contact_number: string | null;
  is_active: boolean;
  is_default: boolean;
  ordering_enabled: boolean;
  operating_hours: BranchOperatingHours | null;
  delivery_location_latitude: number | null;
  delivery_location_longitude: number | null;
  delivery_base_fee: number;
  delivery_distance_increment_meters: number;
  delivery_fee_per_increment: number;
  delivery_max_distance_meters: number;
  created_at: string;
  updated_at: string;
};

export type RestaurantBranchDraft = {
  branch_code: string;
  name: string;
  store_address: string;
  restaurant_address: string;
  contact_number: string;
  is_active: boolean;
  ordering_enabled: boolean;
  operating_hours: BranchOperatingHours;
  delivery_location_latitude: number | null;
  delivery_location_longitude: number | null;
  delivery_base_fee: number;
  delivery_distance_increment_meters: number;
  delivery_fee_per_increment: number;
  delivery_max_distance_meters: number;
};

export const BRANCH_DAYS: Array<{ key: string; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

export const DEFAULT_BRANCH_HOURS: BranchOperatingHours = Object.fromEntries(
  BRANCH_DAYS.map(({ key }) => [key, { isOpen: true, open: '09:00', close: '21:00' }]),
) as BranchOperatingHours;

export function makeDefaultBranchDraft(): RestaurantBranchDraft {
  return {
    branch_code: '',
    name: '',
    store_address: '',
    restaurant_address: '',
    contact_number: '',
    is_active: true,
    ordering_enabled: true,
    operating_hours: structuredClone(DEFAULT_BRANCH_HOURS),
    delivery_location_latitude: null,
    delivery_location_longitude: null,
    delivery_base_fee: 0,
    delivery_distance_increment_meters: 500,
    delivery_fee_per_increment: 10,
    delivery_max_distance_meters: 10000,
  };
}

export function branchToDraft(branch: RestaurantBranch): RestaurantBranchDraft {
  return {
    branch_code: branch.branch_code,
    name: branch.name,
    store_address: branch.store_address ?? branch.restaurant_address ?? '',
    restaurant_address: branch.restaurant_address ?? branch.store_address ?? '',
    contact_number: branch.contact_number ?? '',
    is_active: branch.is_active,
    ordering_enabled: branch.ordering_enabled,
    operating_hours: { ...structuredClone(DEFAULT_BRANCH_HOURS), ...(branch.operating_hours ?? {}) },
    delivery_location_latitude: branch.delivery_location_latitude,
    delivery_location_longitude: branch.delivery_location_longitude,
    delivery_base_fee: Number(branch.delivery_base_fee ?? 0),
    delivery_distance_increment_meters: Number(branch.delivery_distance_increment_meters ?? 500),
    delivery_fee_per_increment: Number(branch.delivery_fee_per_increment ?? 10),
    delivery_max_distance_meters: Number(branch.delivery_max_distance_meters ?? 10000),
  };
}

export function branchBelongsToRestaurant(
  branch: Pick<RestaurantBranch, 'restaurant_id'> | null | undefined,
  restaurantId: string | null | undefined,
): boolean {
  return Boolean(branch && restaurantId && branch.restaurant_id === restaurantId);
}
