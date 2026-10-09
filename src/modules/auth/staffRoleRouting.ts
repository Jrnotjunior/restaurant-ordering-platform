export type RestaurantStaffRole = 'cashier' | 'kitchen' | 'dispatcher' | 'rider';

const STAFF_ROUTE_BY_ROLE: Record<RestaurantStaffRole, string> = {
  cashier: '#restaurant/cashier',
  kitchen: '#restaurant/kitchen',
  dispatcher: '#restaurant/dispatcher',
  rider: '#rider/dashboard',
};

/**
 * Return the canonical route for a verified staff role.
 * Unknown roles intentionally return null so callers can fail closed.
 */
export function staffRouteForRole(role: string | null | undefined): string | null {
  if (!role || !Object.prototype.hasOwnProperty.call(STAFF_ROUTE_BY_ROLE, role)) return null;
  return STAFF_ROUTE_BY_ROLE[role as RestaurantStaffRole];
}
