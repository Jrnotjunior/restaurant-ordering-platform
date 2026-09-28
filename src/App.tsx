import { useEffect, useMemo, useState } from 'react';
import { RestaurantProvider } from './components/RestaurantProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { MenuPage } from './pages/MenuPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { defaultRestaurant } from './config/defaultRestaurant';
import { currentRestaurantLookup } from './config/restaurant';
import { SupabaseRestaurantRepository } from './services/supabaseRestaurantRepository';
import { isSupabaseConfigured } from './services/supabaseClient';
import type { RestaurantConfig } from './types/restaurant';
import type { RestaurantProduct } from './types/menu';

const restaurantRepository = new SupabaseRestaurantRepository();
const CART_STORAGE_KEY = 'restaurant-ordering-cart';

type CartItem = { product: RestaurantProduct; quantity: number };

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  if (path === '/cart') return `${base}/#cart`;
  if (path === '/checkout') return `${base}/#checkout`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function CartPage({ items, onIncrease, onDecrease, onRemove }: {
  items: CartItem[];
  onIncrease: (productId: string) => void;
  onDecrease: (productId: string) => void;
  onRemove: (productId: string) => void;
}) {
  const subtotal = items.reduce((total, item) => total + item.product.price * item.quantity, 0);
  return (
    <section className="cart-page">
      <div className="menu-intro"><p className="eyebrow">Your order</p><h1>Your cart.</h1><p>Review your items before continuing to checkout.</p></div>
      {items.length === 0 ? <div className="cart-empty"><p>Your cart is empty.</p><a className="button button-primary" href={withBasePath('/menu')}>Browse Menu</a></div> : (
        <div className="cart-layout">
          <div className="cart-items" aria-label="Cart items">
            {items.map((item) => <article className="cart-item" key={item.product.id}>
              <div className="cart-item-main"><div><h2>{item.product.name}</h2><p>₱{item.product.price.toFixed(2)} each</p></div><strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong></div>
              <div className="cart-item-actions"><div className="quantity-control" aria-label={`Quantity for ${item.product.name}`}><button type="button" onClick={() => onDecrease(item.product.id)} aria-label={`Decrease ${item.product.name} quantity`}>−</button><span>{item.quantity}</span><button type="button" onClick={() => onIncrease(item.product.id)} aria-label={`Increase ${item.product.name} quantity`}>+</button></div><button className="cart-remove" type="button" onClick={() => onRemove(item.product.id)}>Remove</button></div>
            </article>)}
          </div>
          <aside className="cart-summary"><div className="cart-summary-row"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div><p>Delivery fees and payment details will be calculated during checkout.</p><a className="button button-primary" href={withBasePath('/checkout')}>Continue to Checkout</a></aside>
        </div>
      )}
    </section>
  );
}

export function App() {
  const [restaurant, setRestaurant] = useState<RestaurantConfig>(defaultRestaurant);
  const [route, setRoute] = useState(() => window.location.hash || '');
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try { const stored = window.localStorage.getItem(CART_STORAGE_KEY); return stored ? JSON.parse(stored) as CartItem[] : []; } catch { return []; }
  });

  useEffect(() => { const handleHashChange = () => setRoute(window.location.hash || ''); window.addEventListener('hashchange', handleHashChange); return () => window.removeEventListener('hashchange', handleHashChange); }, []);
  useEffect(() => { window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems)); }, [cartItems]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    restaurantRepository.getRestaurant(currentRestaurantLookup).then((loadedRestaurant) => { if (!cancelled && loadedRestaurant) setRestaurant(loadedRestaurant); }).catch((error: unknown) => console.error('Unable to load restaurant from Supabase.', error));
    return () => { cancelled = true; };
  }, []);

  const cartCount = useMemo(() => cartItems.reduce((total, item) => total + item.quantity, 0), [cartItems]);
  function addToCart(product: RestaurantProduct) { setCartItems((current) => { const existing = current.find((item) => item.product.id === product.id); if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item); return [...current, { product, quantity: 1 }]; }); }
  function changeQuantity(productId: string, delta: number) { setCartItems((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0)); }
  function removeFromCart(productId: string) { setCartItems((current) => current.filter((item) => item.product.id !== productId)); }

  const isMenuPage = route === '#menu' || window.location.pathname.endsWith('/menu') || window.location.pathname.endsWith('/menu/');
  const isCartPage = route === '#cart';
  const isCheckoutPage = route === '#checkout';
  const trackingMatch = route.match(/^#order\/(.+)$/);

  return (
    <RestaurantProvider restaurant={restaurant}>
      <ThemeProvider restaurant={restaurant}>
        <RestaurantLayout>
          {isMenuPage ? <MenuPage onAddToCart={addToCart} cartCount={cartCount} /> : isCartPage ? <CartPage items={cartItems} onIncrease={(id) => changeQuantity(id, 1)} onDecrease={(id) => changeQuantity(id, -1)} onRemove={removeFromCart} /> : isCheckoutPage ? <CheckoutPage items={cartItems} /> : trackingMatch ? <OrderTrackingPage orderNumber={decodeURIComponent(trackingMatch[1])} /> : (
            <section className="hero"><p className="eyebrow">Direct online ordering</p><h1>Order from your favorite local restaurant.</h1><p className="hero-copy">Browse the menu, choose pickup or delivery, and place your order directly.</p><div className="hero-actions"><a className="button button-primary" href={withBasePath('/menu')}>View Menu</a><a className="button button-secondary" href={withBasePath('/cart')}>View Cart{cartCount > 0 ? ` (${cartCount})` : ''}</a></div></section>
          )}
        </RestaurantLayout>
      </ThemeProvider>
    </RestaurantProvider>
  );
}
