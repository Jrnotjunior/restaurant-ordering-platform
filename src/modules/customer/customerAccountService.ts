import { supabaseRpc } from '../../services/supabaseClient';

export type CustomerCheckoutProfile = {
  customerId: string;
  name: string;
  phone: string | null;
  defaultDeliveryCity: string | null;
  defaultDeliveryBarangay: string | null;
  defaultDeliveryAddress: string | null;
  defaultDeliveryLatitude: number | null;
  defaultDeliveryLongitude: number | null;
  defaultDeliveryPlaceId: string | null;
};

export type CustomerSavedAddress = {
  id: string;
  label: string;
  city: string;
  barangay: string;
  address: string;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
};

export async function getMyCustomerProfileId(restaurantId: string): Promise<string | null> {
  const rows = await supabaseRpc<string | null>('get_my_customer_profile_id', {
    p_restaurant_id: restaurantId,
  });
  return rows[0] ?? null;
}

export async function getMyCustomerProfile(restaurantId: string): Promise<CustomerCheckoutProfile | null> {
  const rows = await supabaseRpc<{
    customer_id: string;
    name: string;
    phone: string | null;
    default_delivery_city: string | null;
    default_delivery_barangay: string | null;
    default_delivery_address: string | null;
    default_delivery_latitude: number | null;
    default_delivery_longitude: number | null;
    default_delivery_place_id: string | null;
  }>('get_my_customer_profile', {
    p_restaurant_id: restaurantId,
  });

  const row = rows[0];
  if (!row) return null;

  return {
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone ?? null,
    defaultDeliveryCity: row.default_delivery_city ?? null,
    defaultDeliveryBarangay: row.default_delivery_barangay ?? null,
    defaultDeliveryAddress: row.default_delivery_address ?? null,
    defaultDeliveryLatitude: row.default_delivery_latitude ?? null,
    defaultDeliveryLongitude: row.default_delivery_longitude ?? null,
    defaultDeliveryPlaceId: row.default_delivery_place_id ?? null,
  };
}

export async function saveMyDefaultDeliveryAddress(
  restaurantId: string,
  city: string,
  barangay: string,
  address: string,
  latitude: number | null = null,
  longitude: number | null = null,
  placeId: string | null = null,
): Promise<void> {
  await supabaseRpc('save_my_default_delivery_address', {
    p_restaurant_id: restaurantId,
    p_city: city,
    p_barangay: barangay,
    p_address: address,
    p_latitude: latitude,
    p_longitude: longitude,
    p_place_id: placeId,
  });
}

export async function getMyCustomerAddresses(restaurantId: string): Promise<CustomerSavedAddress[]> {
  const rows = await supabaseRpc<{
    id: string;
    label: string;
    city: string;
    barangay: string;
    address: string;
    is_default: boolean;
    latitude: number | null;
    longitude: number | null;
    place_id: string | null;
  }>('get_my_customer_addresses', { p_restaurant_id: restaurantId });

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    city: row.city,
    barangay: row.barangay,
    address: row.address,
    isDefault: Boolean(row.is_default),
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    placeId: row.place_id ?? null,
  }));
}

export async function saveMyCustomerAddress(
  restaurantId: string,
  label: string,
  city: string,
  barangay: string,
  address: string,
  setDefault: boolean,
  latitude: number | null = null,
  longitude: number | null = null,
  placeId: string | null = null,
): Promise<string> {
  const rows = await supabaseRpc<string>('save_my_customer_address', {
    p_restaurant_id: restaurantId,
    p_label: label,
    p_city: city,
    p_barangay: barangay,
    p_address: address,
    p_set_default: setDefault,
    p_latitude: latitude,
    p_longitude: longitude,
    p_place_id: placeId,
  });
  if (!rows[0]) throw new Error('Unable to save the address.');
  return rows[0];
}

export async function setMyCustomerAddressDefault(
  restaurantId: string,
  addressId: string,
): Promise<void> {
  await supabaseRpc('set_my_customer_address_default', {
    p_restaurant_id: restaurantId,
    p_address_id: addressId,
  });
}

export async function updateMyCustomerAddress(
  restaurantId: string,
  addressId: string,
  label: string,
  city: string,
  barangay: string,
  address: string,
  latitude: number | null = null,
  longitude: number | null = null,
  placeId: string | null = null,
): Promise<void> {
  await supabaseRpc('update_my_customer_address', {
    p_restaurant_id: restaurantId,
    p_address_id: addressId,
    p_label: label,
    p_city: city,
    p_barangay: barangay,
    p_address: address,
    p_latitude: latitude,
    p_longitude: longitude,
    p_place_id: placeId,
  });
}

export async function deleteMyCustomerAddress(
  restaurantId: string,
  addressId: string,
): Promise<void> {
  await supabaseRpc('delete_my_customer_address', {
    p_restaurant_id: restaurantId,
    p_address_id: addressId,
  });
}
