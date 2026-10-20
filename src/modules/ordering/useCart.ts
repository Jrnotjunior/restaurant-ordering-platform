import { useEffect, useMemo, useRef, useState } from 'react';
import type { RestaurantProduct } from '../../types/menu';
import {
  addCartItem,
  CART_CLEAR_EVENT,
  changeCartItemQuantity,
  clearCartPersistence,
  getCartCount,
  LEGACY_CART_STORAGE_KEY,
  loadCustomerCart,
  persistCustomerCart,
  removeCartItem,
} from './cartService';
import type { CartItem } from './cartTypes';

export type UseCartResult = {
  items: CartItem[];
  count: number;
  notification: string;
  addItem: (product: RestaurantProduct) => void;
  increase: (productId: string) => void;
  decrease: (productId: string) => void;
  remove: (productId: string) => void;
  clear: (targetUserId?: string) => void;
  dismissNotification: () => void;
};

export function useCart(userId: string | undefined, authLoading: boolean): UseCartResult {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notification, setNotification] = useState('');
  const hydratedUserIdRef = useRef<string | null>(null);
  const persistenceReadyRef = useRef(false);
  const itemsRef = useRef<CartItem[]>([]);
  const clearedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (authLoading) return;

    persistenceReadyRef.current = false;

    if (!userId) {
      hydratedUserIdRef.current = null;
      setItems([]);
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      return;
    }

    hydratedUserIdRef.current = userId;

    // A successful order explicitly empties the active cart. Do not let a
    // later auth/hydration pass restore the pre-order snapshot from storage.
    if (clearedUserIdRef.current === userId) {
      itemsRef.current = [];
      setItems([]);
      clearCartPersistence(userId);
      persistenceReadyRef.current = true;
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      return;
    }

    const storedItems = loadCustomerCart(userId);

    if (storedItems.length > 0) {
      setItems(storedItems);
    } else if (itemsRef.current.length > 0) {
      persistCustomerCart(userId, itemsRef.current);
    } else {
      setItems([]);
    }

    persistenceReadyRef.current = true;
    window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  }, [authLoading, userId]);

  useEffect(() => {
    if (
      authLoading ||
      !userId ||
      hydratedUserIdRef.current !== userId ||
      !persistenceReadyRef.current
    ) {
      return;
    }

    persistCustomerCart(userId, items);
  }, [authLoading, userId, items]);

  useEffect(() => {
    function handleSuccessfulOrder() {
      clearedUserIdRef.current = userId ?? null;
      itemsRef.current = [];
      setItems([]);
      clearCartPersistence(userId);
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    }

    window.addEventListener(CART_CLEAR_EVENT, handleSuccessfulOrder);
    return () => window.removeEventListener(CART_CLEAR_EVENT, handleSuccessfulOrder);
  }, [userId]);

  useEffect(() => {
    if (!notification) return;

    const timer = window.setTimeout(() => setNotification(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  function addItem(product: RestaurantProduct) {
    clearedUserIdRef.current = null;
    setItems((current) => addCartItem(current, product));
    setNotification(`${product.name} added to cart`);
  }

  function increase(productId: string) {
    setItems((current) => changeCartItemQuantity(current, productId, 1));
  }

  function decrease(productId: string) {
    setItems((current) => changeCartItemQuantity(current, productId, -1));
  }

  function remove(productId: string) {
    setItems((current) => removeCartItem(current, productId));
  }

  function clear(targetUserId?: string) {
    const cartOwnerId = targetUserId ?? userId;
    clearedUserIdRef.current = cartOwnerId ?? null;
    itemsRef.current = [];
    setItems([]);
    clearCartPersistence(cartOwnerId);
    window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  }

  function dismissNotification() {
    setNotification('');
  }

  const count = useMemo(() => getCartCount(items), [items]);

  return {
    items,
    count,
    notification,
    addItem,
    increase,
    decrease,
    remove,
    clear,
    dismissNotification,
  };
}
