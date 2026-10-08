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
  dismissNotification: () => void;
};

export function useCart(userId: string | undefined, authLoading: boolean): UseCartResult {
  const [items, setItems] = useState<CartItem[]>([]);
  const [notification, setNotification] = useState('');
  const hydratedUserIdRef = useRef<string | null>(null);
  const persistenceReadyRef = useRef(false);
  const itemsRef = useRef<CartItem[]>([]);

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

    const storedItems = loadCustomerCart(userId);

    hydratedUserIdRef.current = userId;

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
      setItems([]);
      clearCartPersistence(userId);
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
    dismissNotification,
  };
}
