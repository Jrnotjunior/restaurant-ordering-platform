import type { CartItem } from './cartTypes';

export const CART_STORAGE_KEY = 'restaurant-ordering-cart';
export const LEGACY_CART_STORAGE_KEY = CART_STORAGE_KEY;
export const PENDING_PAYMENT_ORDER_KEY = 'restaurant-ordering-pending-payment-order';
export const PENDING_PAYMENT_REFERENCE_KEY = 'restaurant-ordering-pending-payment-reference';
export const PENDING_PAYMENT_CHECKOUT_URL_KEY = 'restaurant-ordering-pending-payment-checkout-url';
export const CART_CLEAR_EVENT = 'restaurant-ordering-cart-clear';

export function getCustomerCartStorageKey(userId: string) {
  return `${CART_STORAGE_KEY}:${userId}`;
}

export function loadCustomerCart(userId: string): CartItem[] {
  try {
    const stored = window.localStorage.getItem(getCustomerCartStorageKey(userId));
    if (!stored) return [];

    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function persistCustomerCart(userId: string, items: CartItem[]) {
  window.localStorage.setItem(getCustomerCartStorageKey(userId), JSON.stringify(items));
}

export function removeCustomerCart(userId: string) {
  window.localStorage.removeItem(getCustomerCartStorageKey(userId));
}

export function clearCartPersistence(userId?: string | null) {
  if (userId) {
    removeCustomerCart(userId);
  }
  window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  window.localStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
  window.localStorage.removeItem(PENDING_PAYMENT_REFERENCE_KEY);
  window.localStorage.removeItem(PENDING_PAYMENT_CHECKOUT_URL_KEY);
}

export function addCartItem(items: CartItem[], product: CartItem['product']): CartItem[] {
  const existing = items.find((item) => item.product.id === product.id);

  if (existing) {
    return items.map((item) =>
      item.product.id === product.id
        ? { ...item, quantity: item.quantity + 1 }
        : item,
    );
  }

  return [...items, { product, quantity: 1 }];
}

export function changeCartItemQuantity(
  items: CartItem[],
  productId: string,
  delta: number,
): CartItem[] {
  return items
    .map((item) =>
      item.product.id === productId
        ? { ...item, quantity: item.quantity + delta }
        : item,
    )
    .filter((item) => item.quantity > 0);
}

export function removeCartItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.product.id !== productId);
}

export function getCartCount(items: CartItem[]) {
  return items.reduce((total, item) => total + item.quantity, 0);
}
