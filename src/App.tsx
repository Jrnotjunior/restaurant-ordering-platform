import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RestaurantProvider } from './components/RestaurantProvider';
import { RestaurantOwnerAuthProvider, useRestaurantOwnerAuth } from './components/RestaurantOwnerAuthProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { MenuPage } from './pages/MenuPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { RestaurantOrdersPage } from './pages/RestaurantOrdersPage';
import { RestaurantMenuPage } from './pages/RestaurantMenuPage';
import { RestaurantShippingFeePage } from './pages/RestaurantShippingFeePage';
import { RestaurantSalesPage } from './pages/RestaurantSalesPage';
import { RestaurantCashierPosPage } from './pages/RestaurantCashierPosPage';
import { RestaurantDeliveryDispatchPage } from './pages/RestaurantDeliveryDispatchPage';
import { RestaurantSettingsPage } from './pages/RestaurantSettingsPage';
import { RestaurantWebsiteCustomizationPage } from './pages/RestaurantWebsiteCustomizationPage';
import { RestaurantLoyaltyPage } from './pages/RestaurantLoyaltyPage';
import { RestaurantOwnerLoginPage } from './pages/RestaurantOwnerLoginPage';
import { RestaurantEmployeesPage } from './pages/RestaurantEmployeesPage';
import { RestaurantEmployeeInvitePage } from './pages/RestaurantEmployeeInvitePage';
import { RestaurantRoleDashboardPage } from './pages/RestaurantRoleDashboardPage';
import { RestaurantKitchenPage } from './pages/RestaurantKitchenPage';
import { CustomerSignUpPage } from './pages/CustomerSignUpPage';
import { PrivacyNoticePage } from './pages/PrivacyNoticePage';
import { SavedAddressPage } from './pages/SavedAddressPage';
import { CustomerOrderHistoryPage } from './pages/CustomerOrderHistoryPage';
import { RiderDeliveryPage } from './pages/RiderDeliveryPage';
import { RiderDashboardPage } from './pages/RiderDashboardPage';
import { RiderInvitePage } from './pages/RiderInvitePage';
import { TenantOnboardingPage } from './pages/TenantOnboardingPage';
import { defaultRestaurant } from './config/defaultRestaurant';
import { currentRestaurantLookup } from './config/restaurant';
import { SupabaseRestaurantRepository } from './services/supabaseRestaurantRepository';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import type { RestaurantConfig } from './types/restaurant';
import { isRestaurantCurrentlyOpen } from './utils/restaurantHours';
import type { RestaurantProduct } from './types/menu';
import './styles/cart-empty.css';
import './styles/cart-notification.css';

const restaurantRepository = new SupabaseRestaurantRepository();
const CART_STORAGE_KEY = 'restaurant-ordering-cart';
const LEGACY_CART_STORAGE_KEY = CART_STORAGE_KEY;
const PENDING_PAYMENT_ORDER_KEY = 'restaurant-ordering-pending-payment-order';
const PENDING_PAYMENT_REFERENCE_KEY = 'restaurant-ordering-pending-payment-reference';
const PENDING_PAYMENT_CHECKOUT_URL_KEY = 'restaurant-ordering-pending-payment-checkout-url';
const CART_CLEAR_EVENT = 'restaurant-ordering-cart-clear';
type CartItem = { product: RestaurantProduct; quantity: number };

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  if (path === '/cart') return `${base}/#cart`;
  if (path === '/checkout') return `${base}/#checkout`;
  if (path === '/account') return `${base}/#account`;
  if (path === '/signup') return `${base}/#signup`;
  if (path === '/privacy') return `${base}/#privacy`;
  if (path === '/restaurant/orders') return `${base}/#restaurant/orders`;
  if (path === '/restaurant/menu') return `${base}/#restaurant/menu`;
  if (path === '/restaurant/shipping-fee') return `${base}/#restaurant/shipping-fee`;
  if (path === '/restaurant/sales') return `${base}/#restaurant/sales`;
  if (path === '/restaurant/riders') return `${base}/#restaurant/riders`;
  if (path === '/restaurant/delivery-dispatch') return `${base}/#restaurant/delivery-dispatch`;
  if (path === '/restaurant/settings') return `${base}/#restaurant/settings`;
  if (path === '/restaurant/website-customization') return `${base}/#restaurant/website-customization`;
  if (path === '/restaurant/loyalty') return `${base}/#restaurant/loyalty`;
  if (path === '/restaurant/employees') return `${base}/#restaurant/employees`;
  if (path === '/rider/dashboard') return `${base}/#rider/dashboard`;
  if (path === '/rider/delivery-preview') return `${base}/#rider/dashboard`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeHashRoute(hash: string) {
  return hash.replace(/^#\//, '#');
}

function RiderRouteGuard({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkRiderAccess() {
      if (!supabase) {
        if (mounted) setChecking(false);
        return;
      }

      const { data, error: authError } = await supabase.auth.getUser();
      if (authError) {
        window.location.hash = '#account';
        return;
      }

      const user = data.user;
      const role = user?.app_metadata?.role ?? user?.user_metadata?.role;

      if (!mounted) return;

      if (role === 'rider' || user) {
        if (user) {
          const { data: riderProfile } = await supabase
            .from('restaurant_staff')
            .select('id')
            .eq('auth_user_id', user.id)
            .eq('role', 'rider')
            .eq('is_active', true)
            .maybeSingle();

          if (!mounted) return;

          if (riderProfile || role === 'rider') {
            setChecking(false);
            return;
          }
        }
      }

      if (role === 'customer') {
        window.location.hash = '#menu';
        return;
      }

      if (user) {
        const { data: ownerRestaurant } = await supabase
          .from('restaurants')
          .select('id')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (!mounted) return;

        if (ownerRestaurant) {
          window.location.hash = '#restaurant/orders';
          return;
        }
      }

      window.location.hash = '#account';
    }

    void checkRiderAccess();

    return () => {
      mounted = false;
    };
  }, []);

  if (checking) {
    return <section className="restaurant-owner-auth-loading">Checking account access…</section>;
  }

  return <>{children}</>;
}

function CartPage({ items, onIncrease, onDecrease, onRemove }: { items: CartItem[]; onIncrease: (productId: string) => void; onDecrease: (productId: string) => void; onRemove: (productId: string) => void; }) {
  const subtotal = items.reduce((total, item) => total + item.product.price * item.quantity, 0);
  return <section className="cart-page"><div className="menu-intro"><p className="eyebrow">Your order</p><h1>Your cart.</h1><p>Review your items before checkout.</p></div>{items.length === 0 ? <div className="cart-empty"><p>Your cart is empty.</p><a className="button button-primary" href={withBasePath('/menu')}>Browse Menu</a></div> : <div className="cart-layout"><div className="cart-items" aria-label="Cart items">{items.map((item) => <article className="cart-item" key={item.product.id}><div className="cart-item-main"><div><h2>{item.product.name}</h2><p>₱{item.product.price.toFixed(2)} each</p></div><strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong></div><div className="cart-item-actions"><div className="quantity-control" aria-label={`Quantity for ${item.product.name}`}><button type="button" onClick={() => onDecrease(item.product.id)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => onIncrease(item.product.id)}>+</button></div><button className="cart-remove" type="button" onClick={() => onRemove(item.product.id)}>Remove</button></div></article>)}</div><aside className="cart-summary"><div className="cart-summary-row"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div><p>Delivery fees and payment details will be calculated during checkout.</p><a className="button button-primary" href={withBasePath('/checkout')}>Continue to Checkout</a></aside></div>}</section>;
}

function ownerRestaurantConfig(restaurant: NonNullable<ReturnType<typeof useRestaurantOwnerAuth>['restaurant']>): RestaurantConfig {
  return { ...defaultRestaurant, id: restaurant.id, name: restaurant.name, tagline: restaurant.tagline, logoUrl: restaurant.logo_url ?? undefined, locationText: restaurant.location_text ?? undefined, contactNumber: restaurant.contact_number ?? undefined, email: restaurant.email ?? undefined };
}

function OwnerRestaurantGuard({ children }: { children: (restaurant: RestaurantConfig) => ReactNode }) {
  const { restaurant, user } = useRestaurantOwnerAuth();
  const [checkingRole, setCheckingRole] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      if (!user || !supabase) {
        if (mounted) setCheckingRole(false);
        return;
      }

      const role = user.app_metadata?.role ?? user.user_metadata?.role;

      if (role === 'customer') {
        window.location.hash = '#menu';
        return;
      }

      const { data: riderProfile, error: riderLookupError } = await supabase
        .from('restaurant_staff')
        .select('id')
        .eq('auth_user_id', user.id)
        .eq('role', 'rider')
        .eq('is_active', true)
        .maybeSingle();

      if (!mounted) return;

      if (riderLookupError) {
        console.error('Unable to verify rider access.', riderLookupError);
        setCheckingRole(false);
        return;
      }

      if (riderProfile || role === 'rider') {
        window.location.hash = '#rider/dashboard';
        return;
      }

      setCheckingRole(false);
    }

    void checkAccess();

    return () => {
      mounted = false;
    };
  }, [user]);

  if (!user) return <RestaurantOwnerLoginPage />;

  if (checkingRole) {
    return <section className="restaurant-owner-auth-loading">Checking account access…</section>;
  }

  if (!restaurant) return <section className="restaurant-owner-auth-no-restaurant"><div className="restaurant-owner-auth-no-restaurant-card"><p className="eyebrow">Restaurant operations</p><h1>No restaurant assigned</h1><p>Your owner account is signed in, but it is not linked to an active restaurant yet. Set the restaurant's <code>owner_id</code> to your Supabase Auth user ID, then reload this page.</p><p><strong>Signed in as:</strong> {user.email ?? user.id}</p></div></section>;

  return children(ownerRestaurantConfig(restaurant));
}

function StaffRoleGuard({ role, children }: { role: 'cashier' | 'kitchen' | 'dispatcher'; children: (restaurant: RestaurantConfig) => ReactNode }) {
  const { user, loading: authLoading } = useRestaurantOwnerAuth();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function checkStaffAccess() {
      if (authLoading) return;
      if (!user || !supabase) {
        if (mounted) setChecking(false);
        return;
      }

      const { data: staffRows, error } = await supabase
        .from('restaurant_staff')
        .select('restaurant_id,role')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      const data = staffRows?.[0] ?? null;

      if (!mounted) return;

      if (error) {
        console.error('Unable to verify staff access.', error);
        setChecking(false);
        return;
      }

      if (data?.role === role && data.restaurant_id) {
        setRestaurantId(data.restaurant_id);
        setAllowed(true);
      }

      setChecking(false);
    }

    void checkStaffAccess();
    return () => { mounted = false; };
  }, [role, user]);

  if (!user) return <RestaurantOwnerLoginPage />;
  if (checking) return <section className="restaurant-owner-auth-loading">Checking employee access…</section>;

  if (!allowed || !restaurantId) {
    window.location.hash = '#account';
    return <section className="restaurant-owner-auth-loading">Redirecting to sign in…</section>;
  }

  return children({ ...defaultRestaurant, id: restaurantId });
}

function PublicCustomerRouteGuard({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useRestaurantOwnerAuth();
  const [checking, setChecking] = useState(true);
  const [staffRole, setStaffRole] = useState<'cashier' | 'kitchen' | 'dispatcher' | 'rider' | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkPublicAccess() {
      if (authLoading) return;

      if (!user || !supabase) {
        if (mounted) {
          setStaffRole(null);
          setChecking(false);
        }
        return;
      }

      const metadataRole = user.app_metadata?.role ?? user.user_metadata?.role;

      if (metadataRole === 'rider') {
        if (mounted) setStaffRole('rider');
        return;
      }

      const { data: staffRows, error } = await supabase
        .from('restaurant_staff')
        .select('role')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      if (!mounted) return;

      if (error) {
        console.error('Unable to verify employee access on public route.', error);
        setStaffRole(null);
        setChecking(false);
        return;
      }

      const role = staffRows?.[0]?.role;
      if (role === 'cashier' || role === 'kitchen' || role === 'dispatcher' || role === 'rider') {
        setStaffRole(role);
      } else {
        setStaffRole(null);
      }

      setChecking(false);
    }

    void checkPublicAccess();
    return () => { mounted = false; };
  }, [authLoading, user]);

  useEffect(() => {
    if (checking || !staffRole) return;

    const destination =
      staffRole === 'cashier' ? '#restaurant/cashier'
        : staffRole === 'kitchen' ? '#restaurant/kitchen'
          : staffRole === 'dispatcher' ? '#restaurant/dispatcher'
            : '#rider/dashboard';

    if (window.location.hash !== destination) {
      window.location.hash = destination;
    }
  }, [checking, staffRole]);

  if (staffRole) {
    return <section className="restaurant-owner-auth-loading">Redirecting to your workspace…</section>;
  }

  return <>{children}</>;
}

function AppContent() {
  const [restaurant, setRestaurant] = useState<RestaurantConfig>(defaultRestaurant);
  const [route, setRoute] = useState(() => normalizeHashRoute(window.location.hash || ''));
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartNotification, setCartNotification] = useState('');
  const { user, loading: authLoading, error: authError } = useRestaurantOwnerAuth();
  const hydratedCartUserIdRef = useRef<string | null>(null);
  const cartPersistenceReadyRef = useRef(false);
  const cartItemsRef = useRef<CartItem[]>([]);

  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  // Guest carts exist only in memory. Once a customer is authenticated,
  // their cart is persisted to a user-scoped browser key so it survives
  // navigation and refreshes without being shared with another account.
  useEffect(() => {
    if (authLoading || !user || !supabase) return;

    const client = supabase;
    const currentUser = user;
    const role = currentUser.app_metadata?.role ?? currentUser.user_metadata?.role;
    if (role !== 'customer') return;

    let cancelled = false;

    const touchPresence = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;

      const { error } = await client.rpc('customer_touch_presence');
      if (error) {
        console.error('Unable to update customer presence.', error);
      }
    };

    void touchPresence();

    const interval = window.setInterval(() => {
      void touchPresence();
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void touchPresence();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading) return;

    cartPersistenceReadyRef.current = false;

    if (!user) {
      hydratedCartUserIdRef.current = null;
      setCartItems([]);
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      return;
    }

    const storageKey = CART_STORAGE_KEY + ':' + user.id;
    let storedItems: CartItem[] = [];

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) storedItems = JSON.parse(stored) as CartItem[];
    } catch {
      storedItems = [];
    }

    hydratedCartUserIdRef.current = user.id;

    if (storedItems.length > 0) {
      setCartItems(storedItems);
    } else if (cartItemsRef.current.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(cartItemsRef.current));
    } else {
      setCartItems([]);
    }

    cartPersistenceReadyRef.current = true;
    window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading || !user || hydratedCartUserIdRef.current !== user.id || !cartPersistenceReadyRef.current) return;
    const storageKey = CART_STORAGE_KEY + ':' + user.id;
    window.localStorage.setItem(storageKey, JSON.stringify(cartItems));
  }, [authLoading, user?.id, cartItems]);

  useEffect(() => { const handleHashChange = () => { setRoute(normalizeHashRoute(window.location.hash || '')); }; window.addEventListener('hashchange', handleHashChange); return () => window.removeEventListener('hashchange', handleHashChange); }, []);
  useEffect(() => {
    function handleSuccessfulOrder() {
      setCartItems([]);
      if (user) {
        window.localStorage.removeItem(CART_STORAGE_KEY + ':' + user.id);
      }
      window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
      window.localStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
      window.localStorage.removeItem(PENDING_PAYMENT_REFERENCE_KEY);
      window.localStorage.removeItem(PENDING_PAYMENT_CHECKOUT_URL_KEY);
    }
    window.addEventListener(CART_CLEAR_EVENT, handleSuccessfulOrder);
    return () => window.removeEventListener(CART_CLEAR_EVENT, handleSuccessfulOrder);
  }, [user?.id]);
  useEffect(() => { if (!cartNotification) return; const timer = window.setTimeout(() => setCartNotification(''), 3000); return () => window.clearTimeout(timer); }, [cartNotification]);
  useEffect(() => { if (!isSupabaseConfigured) return; let cancelled = false; const hostname = window.location.hostname.trim().toLowerCase(); const configuredSlug = currentRestaurantLookup.slug; const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'; const lookup = !isLocalHost && hostname ? { domain: hostname } : { slug: configuredSlug }; restaurantRepository.getRestaurant(lookup).then((loadedRestaurant) => { if (!cancelled && loadedRestaurant) setRestaurant(loadedRestaurant); }).catch((error: unknown) => console.error('Unable to load restaurant from Supabase.', error)); return () => { cancelled = true; }; }, []);

  const [restaurantOpen, setRestaurantOpen] = useState(() => restaurant.orderingEnabled !== false && isRestaurantCurrentlyOpen(restaurant.operatingHours));
  useEffect(() => {
    const updateRestaurantOpen = () => setRestaurantOpen(restaurant.orderingEnabled !== false && isRestaurantCurrentlyOpen(restaurant.operatingHours));
    updateRestaurantOpen();
    const timer = window.setInterval(updateRestaurantOpen, 30_000);
    return () => window.clearInterval(timer);
  }, [restaurant.operatingHours]);

  const cartCount = useMemo(() => cartItems.reduce((total, item) => total + item.quantity, 0), [cartItems]);
  function addToCart(product: RestaurantProduct) {
    if (!restaurantOpen) return;
    setCartItems((current) => { const existing = current.find((item) => item.product.id === product.id); if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item); return [...current, { product, quantity: 1 }]; }); setCartNotification(`${product.name} added to cart`); }
  function changeQuantity(productId: string, delta: number) { setCartItems((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0)); }
  function removeFromCart(productId: string) { setCartItems((current) => current.filter((item) => item.product.id !== productId)); }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const isInviteCallback = hashParams.get('type') === 'invite' || searchParams.get('type') === 'invite' || Boolean(hashParams.get('token_hash') || searchParams.get('token_hash')) || Boolean(hashParams.get('error_code') || searchParams.get('error_code') || hashParams.get('error') || searchParams.get('error'));
  const isMenuPage = route === '#menu' || window.location.pathname.endsWith('/menu') || window.location.pathname.endsWith('/menu/');
  const isCartPage = route === '#cart';
  const isAccountPage = route === '#account';
  const isSignUpPage = route === '#signup';
  const isPrivacyPage = route === '#privacy';
  const isCheckoutPage = route === '#checkout';
  const trackOrderNumber = searchParams.get('trackOrder');
  const isRestaurantOrdersPage = route === '#restaurant/orders';
  const isRestaurantMenuPage = route === '#restaurant/menu';
  const isRestaurantShippingFeePage = route === '#restaurant/shipping-fee';
  const isRestaurantSalesPage = route === '#restaurant/sales';
  const isCashierSalesPage = route === '#restaurant/cashier-sales';
  const isCashierPosPage = route === '#restaurant/cashier-pos';
  const isRestaurantDeliveryDispatchPage = route === '#restaurant/delivery-dispatch';
  const isRestaurantSettingsPage = route === '#restaurant/settings';
  const isRestaurantWebsiteCustomizationPage = route === '#restaurant/website-customization';
  const isRestaurantLoyaltyPage = route === '#restaurant/loyalty';
  const isRestaurantEmployeesPage = route === '#restaurant/employees';
  const isCashierPage = route === '#restaurant/cashier';
  const isKitchenPage = route === '#restaurant/kitchen';
  const isKitchenMenuPage = route === '#restaurant/kitchen-menu';
  const isDispatcherPage = route === '#restaurant/dispatcher';
  const restaurantRoleRoute = route.match(/^#restaurant\/(owner|cashier|kitchen|dispatcher)$/)?.[1] as 'owner' | 'cashier' | 'kitchen' | 'dispatcher' | undefined;
  const isRiderDashboardPage = route === '#rider/dashboard' || route === '#rider/delivery-preview';
  const riderDeliveryMatch = route.match(/^#rider\/delivery\/([^/]+)$/);
  const isRiderInvitePath = window.location.pathname.endsWith('/invite') || window.location.pathname.endsWith('/invite/');
  const isRiderInvitePage = isRiderInvitePath || searchParams.get('invite') === '1' || isInviteCallback;
  const isEmployeeInvitePage = window.location.pathname.endsWith('/employee-invite') || window.location.pathname.endsWith('/employee-invite/') || searchParams.get('employee-invite') === '1';
  const isTenantInvitePage = searchParams.get('tenant-invite') === '1' || hashParams.get('type') === 'invite';
  const isRestaurantOperationsPage = isRestaurantOrdersPage || isRestaurantMenuPage || isRestaurantShippingFeePage || isRestaurantSalesPage || isRestaurantDeliveryDispatchPage || isRestaurantSettingsPage || isRestaurantWebsiteCustomizationPage || isRestaurantLoyaltyPage || isRestaurantEmployeesPage;
  const trackingMatch = route.match(/^#order\/(.+)$/);

  if (isTenantInvitePage) return <TenantOnboardingPage />;
  if (isEmployeeInvitePage) return <RestaurantEmployeeInvitePage />;
  if (isRiderInvitePage) return <RiderInvitePage />;
  if (isSignUpPage) return <CustomerSignUpPage />;
  if (isPrivacyPage) return <PrivacyNoticePage />;
  if (route === '#saved-address') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><SavedAddressPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (route === '#order-history') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><CustomerOrderHistoryPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (isAccountPage) return <RestaurantOwnerLoginPage />;
  if (isRiderDashboardPage) return <RiderRouteGuard><RiderDashboardPage /></RiderRouteGuard>;
  if (riderDeliveryMatch) return <RiderRouteGuard><RiderDeliveryPage orderId={decodeURIComponent(riderDeliveryMatch[1])} /></RiderRouteGuard>;

  const publicContent = trackOrderNumber ? <OrderTrackingPage orderNumber={trackOrderNumber} /> : isMenuPage || (!isCartPage && !isCheckoutPage && !trackingMatch) ? <MenuPage onAddToCart={addToCart} cartCount={cartCount} /> : isCartPage ? <CartPage items={cartItems} onIncrease={(id) => changeQuantity(id, 1)} onDecrease={(id) => changeQuantity(id, -1)} onRemove={(id) => removeFromCart(id)} /> : isCheckoutPage ? <CheckoutPage items={cartItems} /> : <OrderTrackingPage orderNumber={decodeURIComponent(trackingMatch![1])} />;

  if (isCashierPosPage) {
    return <StaffRoleGuard role="cashier">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="cashier">
            <RestaurantCashierPosPage restaurantId={staffRestaurant.id!} />
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</StaffRoleGuard>;
  }

  if (isCashierPage) {
    return <StaffRoleGuard role="cashier">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="cashier">
            <RestaurantOrdersPage restaurantId={staffRestaurant.id!} role="cashier" />
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</StaffRoleGuard>;
  }

  if (isKitchenPage || isKitchenMenuPage) {
    return <StaffRoleGuard role="kitchen">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="kitchen">
            <RestaurantKitchenPage restaurantId={staffRestaurant.id!} view={isKitchenMenuPage ? 'menu' : 'orders'} />
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</StaffRoleGuard>;
  }

  if (isCashierSalesPage) {
    return <StaffRoleGuard role="cashier">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="cashier">
            <RestaurantSalesPage restaurantId={staffRestaurant.id!} role="cashier" />
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</StaffRoleGuard>;
  }

  if (isDispatcherPage) {
    return <StaffRoleGuard role="dispatcher">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="dispatcher">
            <RestaurantDeliveryDispatchPage restaurantId={staffRestaurant.id!} role="dispatcher" />
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</StaffRoleGuard>;
  }

  if (restaurantRoleRoute) {
    if (authLoading) return <section className="restaurant-owner-auth-loading">Loading restaurant session…</section>;
    if (authError && !isSupabaseConfigured) return <section className="restaurant-owner-auth-loading">{authError}</section>;
    return <OwnerRestaurantGuard>{(ownerRestaurant) => (
      <RestaurantProvider restaurant={ownerRestaurant}>
        <ThemeProvider restaurant={ownerRestaurant}>
          <RestaurantLayout hideChrome role={restaurantRoleRoute} ownerDashboard={restaurantRoleRoute === 'owner'}>
            <RestaurantRoleDashboardPage role={restaurantRoleRoute} restaurantName={ownerRestaurant.name} restaurantId={ownerRestaurant.id!}>
            <div className="restaurant-role-dashboard-card">
              <h2>{restaurantRoleRoute === 'owner' ? 'Restaurant management' : restaurantRoleRoute === 'cashier' ? 'Cashier workspace' : restaurantRoleRoute === 'kitchen' ? 'Kitchen workspace' : 'Dispatch workspace'}</h2>
              <p>This is the dedicated workspace for the {restaurantRoleRoute} role. Page permissions and employee login protection will be connected next.</p>
              <div className="restaurant-role-dashboard-links">
                {restaurantRoleRoute === 'owner' ? <>
                  <a href="#restaurant/orders">Orders</a>
                  <a href="#restaurant/menu">Products</a>
                  <a href="#restaurant/employees">Employees</a>
                  <a href="#restaurant/delivery-dispatch">Dispatch</a>
                  <a href="#restaurant/shipping-fee">Shipping Fee</a>
                  <a href="#restaurant/sales">Sales</a>
                  <a href="#restaurant/settings">Store Settings</a>
                  <a href="#restaurant/website-customization">Customize</a>
                </> : null}
                {restaurantRoleRoute === 'cashier' ? <a href="#restaurant/orders">Open Orders</a> : null}
                {restaurantRoleRoute === 'kitchen' ? <a href="#restaurant/orders">Open Kitchen Orders</a> : null}
                {restaurantRoleRoute === 'dispatcher' ? <a href="#restaurant/delivery-dispatch">Open Dispatch</a> : null}
              </div>
            </div>
            </RestaurantRoleDashboardPage>
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</OwnerRestaurantGuard>;
  }

  if (isRestaurantOperationsPage) {
    if (authLoading) return <section className="restaurant-owner-auth-loading">Loading owner session…</section>;
    if (authError && !isSupabaseConfigured) return <section className="restaurant-owner-auth-loading">{authError}</section>;
    return <OwnerRestaurantGuard>{(ownerRestaurant) => (
      <RestaurantProvider restaurant={ownerRestaurant}>
        <ThemeProvider restaurant={ownerRestaurant}>
          <RestaurantLayout hideChrome role="owner" ownerDashboard>
            {isRestaurantOrdersPage ? <RestaurantOrdersPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantMenuPage ? <RestaurantMenuPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantShippingFeePage ? <RestaurantShippingFeePage restaurantId={ownerRestaurant.id!} />
              : isRestaurantEmployeesPage ? <RestaurantEmployeesPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantDeliveryDispatchPage ? <RestaurantDeliveryDispatchPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantSalesPage ? <RestaurantSalesPage restaurantId={ownerRestaurant.id!} role="owner" />
              : isRestaurantSettingsPage ? <RestaurantSettingsPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantWebsiteCustomizationPage ? <RestaurantWebsiteCustomizationPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantLoyaltyPage ? <RestaurantLoyaltyPage restaurantId={ownerRestaurant.id!} />
              : <RestaurantSalesPage restaurantId={ownerRestaurant.id!} role="owner" />}
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</OwnerRestaurantGuard>;
  }

  const publicPage = <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}>{!restaurantOpen && !trackOrderNumber && !trackingMatch ? <div className="restaurant-closed-overlay" role="dialog" aria-modal="true" aria-label="Store closed"><div className="restaurant-closed-message"><h1>Store Closed</h1><p>We're currently closed and not accepting new orders.</p><span>Please check back when we're open.</span></div></div> : null}{publicContent}{cartNotification ? <div className="cart-notification" role="status" aria-live="polite"><div className="cart-notification-icon" aria-hidden="true">✓</div><div className="cart-notification-content"><strong>Added to cart</strong><span>{cartNotification}</span></div><a className="cart-notification-link" href={withBasePath('/cart')}>View cart</a><button className="cart-notification-close" type="button" aria-label="Dismiss notification" onClick={() => setCartNotification('')}>×</button></div> : null}</RestaurantLayout></ThemeProvider></RestaurantProvider>;
  // Order tracking is a public customer page. It must not wait for employee
  // access checks, so navigating from the header never shows an account guard.
  if (trackOrderNumber || trackingMatch) return publicPage;
  return <PublicCustomerRouteGuard>{publicPage}</PublicCustomerRouteGuard>;
}

export function App() { return <AppContent />; }
export { RestaurantOwnerAuthProvider };