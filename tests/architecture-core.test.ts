import { describe, expect, it } from 'vitest';
import { normalizeHashRoute, resolveAppRoute } from '../src/app/routing/routeResolver';
import { addCartItem, changeCartItemQuantity, getCartCount, removeCartItem } from '../src/modules/ordering/cartService';
import { isInvitationType } from '../src/modules/invitations/invitationTypes';
import { staffRouteForRole } from '../src/modules/auth/staffRoleRouting';
import { resolveInvitationTypeFromMetadata } from '../src/modules/invitations/invitationResolver';
import type { RestaurantProduct } from '../src/types/menu';

const product = (id: string, overrides: Partial<RestaurantProduct> = {}): RestaurantProduct => ({
  id,
  restaurantId: 'restaurant-a',
  categoryId: 'category-a',
  name: `Product ${id}`,
  slug: `product-${id}`,
  description: '',
  price: 100,
  sortOrder: 0,
  isAvailable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const location = (pathname = '/', search = '', hash = '') => ({ pathname, search, hash });

describe('route resolution contract', () => {
  it.each(['owner', 'cashier', 'kitchen', 'dispatcher'] as const)(
    'recognizes the %s role route without conflating role routes',
    (role) => {
      const result = resolveAppRoute(location(), `#restaurant/${role}`);
      expect(result.restaurantRoleRoute).toBe(role);
      expect(result.isRestaurantOperationsPage).toBe(false);
      expect(result.route).toBe(`#restaurant/${role}`);
    },
  );

  it('normalizes legacy hash routes without changing unrelated routes', () => {
    expect(normalizeHashRoute('#/menu')).toBe('');
    expect(normalizeHashRoute('#/restaurant/orders')).toBe('#restaurant/orders');
    expect(normalizeHashRoute('#order/123')).toBe('#order/123');
  });

  it('separates tenant onboarding from the initial tenant invitation landing page', () => {
    const onboarding = resolveAppRoute(location('/', '?tenant-invite=1&tenant-onboarding=1'), '');
    const landing = resolveAppRoute(location('/', '?tenant-invite=1'), '');

    expect(onboarding.isTenantInvitePage).toBe(true);
    expect(onboarding.isTenantInviteLandingPage).toBe(false);
    expect(landing.isTenantInviteLandingPage).toBe(true);
    expect(landing.isTenantInvitePage).toBe(false);
  });

  it('does not misclassify a bare Auth token hash as a tenant invitation', () => {
    const result = resolveAppRoute(location('/', '?token_hash=opaque-token&type=signup'), '');

    expect(result.isTenantInviteLandingPage).toBe(false);
    expect(result.isTenantInvitePage).toBe(false);
  });

  it('recognizes a nested employee invitation callback without treating it as tenant onboarding', () => {
    const callback = encodeURIComponent('https://example.test/restaurant-ordering-platform/?employee-invite=1');
    const result = resolveAppRoute(location('/', `?confirmation_url=${callback}`), '');

    expect(result.isEmployeeInvitePage).toBe(true);
    expect(result.isTenantInviteLandingPage).toBe(false);
  });
});

describe('staff role routing contract', () => {
  it.each([
    ['cashier', '#restaurant/cashier'],
    ['kitchen', '#restaurant/kitchen'],
    ['dispatcher', '#restaurant/dispatcher'],
    ['rider', '#rider/dashboard'],
  ])('routes a verified %s role to its own workspace', (role, route) => {
    expect(staffRouteForRole(role)).toBe(route);
  });

  it.each([null, undefined, '', 'owner', 'customer', 'system_admin'])(
    'fails closed for non-staff or unknown role %s',
    (role) => {
      expect(staffRouteForRole(role)).toBeNull();
    },
  );
});

describe('cart service contract', () => {
  it('increments an existing product instead of duplicating the cart line', () => {
    const first = addCartItem([], product('p1'));
    const next = addCartItem(first, product('p1', { price: 999 }));

    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(2);
    expect(next[0].product.price).toBe(100);
    expect(first[0].quantity).toBe(1);
  });

  it('keeps different products in separate cart lines', () => {
    const result = addCartItem(addCartItem([], product('p1')), product('p2'));

    expect(result.map((item) => item.product.id)).toEqual(['p1', 'p2']);
    expect(getCartCount(result)).toBe(2);
  });

  it('removes a line when quantity reaches zero and does not mutate the input', () => {
    const initial = [{ product: product('p1'), quantity: 1 }];
    const result = changeCartItemQuantity(initial, 'p1', -1);

    expect(result).toEqual([]);
    expect(initial[0].quantity).toBe(1);
  });

  it('changes only the requested product quantity', () => {
    const initial = [
      { product: product('p1'), quantity: 2 },
      { product: product('p2'), quantity: 1 },
    ];
    const result = changeCartItemQuantity(initial, 'p1', 1);

    expect(result.map((item) => item.quantity)).toEqual([3, 1]);
  });

  it('removes only the requested product and totals item quantities', () => {
    const initial = [
      { product: product('p1'), quantity: 2 },
      { product: product('p2'), quantity: 3 },
    ];
    const result = removeCartItem(initial, 'p1');

    expect(result.map((item) => item.product.id)).toEqual(['p2']);
    expect(getCartCount(result)).toBe(3);
  });
});

describe('invitation metadata contract', () => {
  it('accepts only supported invitation types', () => {
    expect(isInvitationType('tenant_owner')).toBe(true);
    expect(isInvitationType('employee_staff')).toBe(true);
    expect(isInvitationType('system_admin')).toBe(false);
    expect(isInvitationType(null)).toBe(false);
  });

  it('resolves valid metadata and safely rejects malformed metadata', () => {
    expect(resolveInvitationTypeFromMetadata({ invitation_type: 'tenant_owner' })).toBe('tenant_owner');
    expect(resolveInvitationTypeFromMetadata({ invitation_type: 'employee_staff' })).toBe('employee_staff');
    expect(resolveInvitationTypeFromMetadata({ invitation_type: 'admin' })).toBeNull();
    expect(resolveInvitationTypeFromMetadata(null)).toBeNull();
    expect(resolveInvitationTypeFromMetadata('tenant_owner')).toBeNull();
  });
});
