import { useEffect, useState, type ReactNode } from 'react';
import { RestaurantProvider } from './components/RestaurantProvider';
import { RestaurantOwnerAuthProvider, useRestaurantOwnerAuth } from './components/RestaurantOwnerAuthProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { MenuPage } from './pages/MenuPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { RestaurantOrdersPage } from './pages/RestaurantOrdersPage';
import { RestaurantMenuPage } from './pages/RestaurantMenuPage';
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
import { CustomerPasswordRecoveryPage } from './pages/CustomerPasswordRecoveryPage';
import { CustomerEmailConfirmationPage } from './pages/CustomerEmailConfirmationPage';
import { PrivacyNoticePage } from './pages/PrivacyNoticePage';
import { SavedAddressPage } from './pages/SavedAddressPage';
import { CustomerOrderHistoryPage } from './pages/CustomerOrderHistoryPage';
import { RiderDeliveryPage } from './pages/RiderDeliveryPage';
import { RiderDashboardPage } from './pages/RiderDashboardPage';
import { TenantOnboardingPage } from './pages/TenantOnboardingPage';
import { TenantInviteLandingPage } from './pages/TenantInviteLandingPage';
import { defaultRestaurant } from './config/defaultRestaurant';
import { currentRestaurantLookup } from './config/restaurant';
import { SupabaseRestaurantRepository } from './modules/restaurant/supabaseRestaurantRepository';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import type { RestaurantConfig } from './types/restaurant';
import type { RestaurantProduct } from './types/menu';
import { isRestaurantCurrentlyOpen } from './utils/restaurantHours';
import './styles/cart-empty.css';
import './styles/cart-notification.css';
import { resolveAuthEntry } from './app/auth/authEntry';
import { normalizeHashRoute, resolveAppRoute } from './app/routing/routeResolver';
import { useCart } from './modules/ordering/useCart';
import { OwnerRestaurantGuard, RestaurantModuleGuard, RiderRouteGuard, StaffRoleGuard } from './modules/auth/authGuards';
import type { CartItem } from './modules/ordering/cartTypes';

const restaurantRepository = new SupabaseRestaurantRepository();



function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/`;
  if (path === '/cart') return `${base}/#cart`;
  if (path === '/checkout') return `${base}/#checkout`;
  if (path === '/account') return `${base}/#account`;
  if (path === '/signup') return `${base}/#signup`;
  if (path === '/privacy') return `${base}/#privacy`;
  if (path === '/restaurant/orders') return `${base}/#restaurant/orders`;
  if (path === '/restaurant/menu') return `${base}/#restaurant/menu`;
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


function CartPage({ items, onIncrease, onDecrease, onRemove }: { items: CartItem[]; onIncrease: (productId: string) => void; onDecrease: (productId: string) => void; onRemove: (productId: string) => void; }) {
  const subtotal = items.reduce((total, item) => total + item.product.price * item.quantity, 0);
  return <section className="cart-page"><div className="menu-intro"><h1>Your cart.</h1><p>Review your items before checkout.</p></div>{items.length === 0 ? <div className="cart-empty"><p>Your cart is empty.</p><a className="button button-primary" href={withBasePath('/menu')}>Browse Menu</a></div> : <div className="cart-layout"><div className="cart-items" aria-label="Cart items">{items.map((item) => <article className="cart-item" key={item.product.id}><div className="cart-item-main"><div><h2>{item.product.name}</h2><p>₱{item.product.price.toFixed(2)}</p></div><strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong></div><div className="cart-item-actions"><div className="quantity-control" aria-label={`Quantity for ${item.product.name}`}><button type="button" onClick={() => onDecrease(item.product.id)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => onIncrease(item.product.id)}>+</button></div><button className="cart-remove" type="button" onClick={() => onRemove(item.product.id)}>Remove</button></div></article>)}</div><aside className="cart-summary"><div className="cart-summary-row"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div><p>Delivery fees and payment details will be calculated during checkout.</p><a className="button button-primary" href={withBasePath('/checkout')}>Continue to Checkout</a></aside></div>}</section>;
}

function PublicCustomerRouteGuard({ children }: { children: ReactNode }) {
  // The public storefront must never wait for authentication, package, or
  // employee-access checks. Those checks belong only to protected routes.
  // This keeps the menu stable and prevents loading/auth screens from
  // flashing over the customer storefront.
  return <>{children}</>;
}

function AppContent() {
  const [restaurant, setRestaurant] = useState<RestaurantConfig>(defaultRestaurant);
  const [route, setRoute] = useState(() => normalizeHashRoute(window.location.hash || ''));
  const { user, loading: authLoading, error: authError } = useRestaurantOwnerAuth();

  useEffect(() => {
    const favicon = restaurant.storefront.faviconUrl;
    // Reuse the favicon link from index.html instead of adding a second one.
    // Keeping the static SVG link first can cause browsers to keep showing the
    // platform icon even after a restaurant-specific favicon is loaded.
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.dataset.restaurantFavicon = 'true';

    // Use a self-contained platform fallback so a missing favicon.ico request
    // does not occur when a restaurant has not uploaded its own icon.
    const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23374151'/%3E%3Cpath d='M20 12v17m-6-17v11c0 5 3 8 6 8s6-3 6-8V12m-6 19v21m19-40v40m0-40c8 0 12 7 12 16v5H39' fill='none' stroke='%23fff' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
    link.href = favicon || fallback;
    // index.html declares its fallback as SVG; clear that MIME type when the
    // uploaded file is PNG/JPG/WebP so the browser can decode the real format.
    link.type = favicon ? '' : 'image/svg+xml';
  }, [restaurant.storefront.faviconUrl]);


  const {
    items: cartItems,
    count: cartCount,
    notification: cartNotification,
    addItem: addCartItem,
    increase: increaseCartItem,
    decrease: decreaseCartItem,
    remove: removeCartItem,
    clear: clearCart,
    dismissNotification: dismissCartNotification,
  } = useCart(user?.id, authLoading);

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
    const handleHashChange = () => {
      setRoute(normalizeHashRoute(window.location.hash || ''));
    };

    window.addEventListener('hashchange', handleHashChange);

    if (window.location.hash === '#menu') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    const hostname = window.location.hostname.trim().toLowerCase();
    const configuredSlug = currentRestaurantLookup.slug;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    // GitHub Pages hosts the app under a shared github.io hostname, not the
    // restaurant's custom domain. Resolve the configured demo tenant by slug
    // there so its saved storefront settings (including faviconUrl) load.
    const isGitHubPagesHost = hostname === 'github.io' || hostname.endsWith('.github.io');
    const lookup = !isLocalHost && hostname && !isGitHubPagesHost
      ? { domain: hostname }
      : { slug: configuredSlug };

    restaurantRepository.getRestaurant(lookup)
      .then((loadedRestaurant) => {
        if (!cancelled && loadedRestaurant) setRestaurant(loadedRestaurant);
      })
      .catch((error: unknown) => console.error('Unable to load restaurant from Supabase.', error));

    return () => {
      cancelled = true;
    };
  }, []);

  const [showStoreClosedModal, setShowStoreClosedModal] = useState(false);

  async function addToCart(product: RestaurantProduct) {
    let storeOpen = true;

    if (supabase && restaurant.id) {
      const { data, error } = await supabase
        .from('restaurants')
        .select('ordering_enabled,operating_hours')
        .eq('id', restaurant.id)
        .single();

      if (error) {
        console.error('Unable to verify store status before adding to cart.', error);
        storeOpen = false;
      } else {
        storeOpen = data?.ordering_enabled !== false && isRestaurantCurrentlyOpen(data?.operating_hours as RestaurantConfig['operatingHours'] | undefined);
      }
    } else {
      storeOpen = isRestaurantCurrentlyOpen(restaurant.operatingHours);
    }

    if (!storeOpen) {
      setShowStoreClosedModal(true);
      return;
    }

    addCartItem(product);
  }

  const routeContext = resolveAppRoute(window.location, route);
  const {
    isMenuPage,
    isCartPage,
    isAccountPage,
    isSignUpPage,
    isCustomerEmailConfirmationPage,
    isCustomerPasswordResetPage,
    isCustomerForgotPasswordPage,
    isPrivacyPage,
    isCheckoutPage,
    trackOrderNumber,
    isRestaurantOrdersPage,
    isRestaurantMenuPage,
    isRestaurantSalesPage,
    isCashierSalesPage,
    isCashierPosPage,
    isRestaurantDeliveryDispatchPage,
    isRestaurantSettingsPage,
    isRestaurantWebsiteCustomizationPage,
    isRestaurantLoyaltyPage,
    isRestaurantEmployeesPage,
    isCashierPage,
    isKitchenPage,
    isKitchenMenuPage,
    isDispatcherPage,
    restaurantRoleRoute,
    isRiderDashboardPage,
    riderDeliveryMatch,
    isLegacyEmployeeInvitePage,
    isEmployeeInvitePage,
    isTenantInviteLandingPage,
    isTenantInvitePage,
    isRestaurantOperationsPage,
    trackingMatch,
  } = routeContext;

  if (isTenantInviteLandingPage) return <TenantInviteLandingPage />;
  if (isTenantInvitePage) return <TenantOnboardingPage />;
  if (isEmployeeInvitePage) return <RestaurantEmployeeInvitePage />;
  if (isLegacyEmployeeInvitePage) return <RestaurantEmployeeInvitePage />;
  if (isCustomerPasswordResetPage) return <CustomerPasswordRecoveryPage mode="reset" />;
  if (isCustomerForgotPasswordPage) return <CustomerPasswordRecoveryPage mode="request" />;
  if (isSignUpPage) return <CustomerSignUpPage />;
  if (isCustomerEmailConfirmationPage || new URLSearchParams(window.location.search).get('customer-confirmation') === '1') {
    return <CustomerEmailConfirmationPage />;
  }
  if (isPrivacyPage) return <PrivacyNoticePage />;
  if (route === '#saved-address') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><SavedAddressPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (route === '#order-history') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><CustomerOrderHistoryPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (isAccountPage) return <RestaurantOwnerLoginPage />;
  if (isRiderDashboardPage) return <RiderRouteGuard><RiderDashboardPage /></RiderRouteGuard>;
  if (riderDeliveryMatch) return <RiderRouteGuard><RiderDeliveryPage orderId={decodeURIComponent(riderDeliveryMatch[1])} /></RiderRouteGuard>;

  const publicContent = trackOrderNumber ? <OrderTrackingPage orderId={trackOrderNumber} /> : isMenuPage || (!isCartPage && !isCheckoutPage && !trackingMatch) ? <MenuPage onAddToCart={addToCart} cartCount={cartCount} /> : isCartPage ? <CartPage items={cartItems} onIncrease={increaseCartItem} onDecrease={decreaseCartItem} onRemove={removeCartItem} /> : isCheckoutPage ? <CheckoutPage items={cartItems} onClearCart={clearCart} /> : <OrderTrackingPage orderId={decodeURIComponent(trackingMatch![1])} />;

  if (isCashierPosPage) {
    return <StaffRoleGuard role="cashier">{(staffRestaurant) => (
      <RestaurantProvider restaurant={staffRestaurant}>
        <ThemeProvider restaurant={staffRestaurant}>
          <RestaurantLayout hideChrome role="cashier">
            <RestaurantModuleGuard restaurantId={staffRestaurant.id!} anyOf={['pos']}>
              <RestaurantCashierPosPage restaurantId={staffRestaurant.id!} />
            </RestaurantModuleGuard>
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
            <RestaurantModuleGuard restaurantId={staffRestaurant.id!} anyOf={['pos']}>
              <RestaurantOrdersPage restaurantId={staffRestaurant.id!} role="cashier" />
            </RestaurantModuleGuard>
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
            <RestaurantModuleGuard restaurantId={staffRestaurant.id!} anyOf={['kitchen']}>
              <RestaurantKitchenPage restaurantId={staffRestaurant.id!} view={isKitchenMenuPage ? 'menu' : 'orders'} />
            </RestaurantModuleGuard>
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
            <RestaurantModuleGuard restaurantId={staffRestaurant.id!} anyOf={['pos']}>
              <RestaurantSalesPage restaurantId={staffRestaurant.id!} role="cashier" />
            </RestaurantModuleGuard>
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
            <RestaurantModuleGuard restaurantId={staffRestaurant.id!} anyOf={['dispatch_delivery']}>
              <RestaurantDeliveryDispatchPage restaurantId={staffRestaurant.id!} role="dispatcher" />
            </RestaurantModuleGuard>
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
            {isRestaurantOrdersPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['self_ordering', 'dispatch_delivery']}>
                  <RestaurantOrdersPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantMenuPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['self_ordering', 'pos', 'kitchen']}>
                  <RestaurantMenuPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantEmployeesPage ? <RestaurantEmployeesPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantDeliveryDispatchPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['dispatch_delivery']}>
                  <RestaurantDeliveryDispatchPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantSalesPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['sales']}>
                  <RestaurantSalesPage restaurantId={ownerRestaurant.id!} role="owner" />
                </RestaurantModuleGuard>
              ) : isRestaurantSettingsPage ? <RestaurantSettingsPage restaurantId={ownerRestaurant.id!} />
              : isRestaurantWebsiteCustomizationPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['website']}>
                  <RestaurantWebsiteCustomizationPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantLoyaltyPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['loyalty']}>
                  <RestaurantLoyaltyPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : <RestaurantSalesPage restaurantId={ownerRestaurant.id!} role="owner" />}
          </RestaurantLayout>
        </ThemeProvider>
      </RestaurantProvider>
    )}</OwnerRestaurantGuard>;
  }

  const isPublicMenuView = isMenuPage || (!isCartPage && !isCheckoutPage && !trackingMatch && !trackOrderNumber);
  const publicPage = <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount} compactPublicChrome>{publicContent}{showStoreClosedModal ? (
    <div className="restaurant-closed-modal-backdrop" role="presentation" onClick={() => setShowStoreClosedModal(false)}>
      <div className="restaurant-closed-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-closed-modal-title" onClick={(event) => event.stopPropagation()}>
        <button className="restaurant-closed-modal-close" type="button" aria-label="Close" onClick={() => setShowStoreClosedModal(false)}>×</button>
        <h2 id="restaurant-closed-modal-title">Store Closed</h2>
        <p>We're currently closed and not accepting new orders.</p>
        <span>Please check back when we're open.</span>
        <button className="button button-primary restaurant-closed-modal-button" type="button" onClick={() => setShowStoreClosedModal(false)}>Okay</button>
      </div>
    </div>
  ) : null}{cartNotification ? <div className="cart-notification" role="status" aria-live="polite"><div className="cart-notification-icon" aria-hidden="true">✓</div><div className="cart-notification-content"><strong>Added to cart</strong><span>{cartNotification}</span></div><a className="cart-notification-link" href={withBasePath('/cart')}>View cart</a><button className="cart-notification-close" type="button" aria-label="Dismiss notification" onClick={dismissCartNotification}>×</button></div> : null}</RestaurantLayout></ThemeProvider></RestaurantProvider>;
  // Order tracking is a public customer page. It must not wait for employee
  // access checks, so navigating from the header never shows an account guard.
  if (trackOrderNumber || trackingMatch) return publicPage;
  return <PublicCustomerRouteGuard>{publicPage}</PublicCustomerRouteGuard>;
}

export function App() {
  const authEntry = resolveAuthEntry(window.location);

  // Invitation callbacks are resolved before the normal application auth
  // provider. Customer confirmation callbacks intentionally resolve to the
  // normal app and therefore cannot enter tenant onboarding.
  if (authEntry === 'tenant-invitation') {
    return <TenantInviteLandingPage />;
  }
  if (authEntry === 'employee-invitation') {
    return <RestaurantEmployeeInvitePage />;
  }

  return (
    <RestaurantOwnerAuthProvider>
      <AppContent />
    </RestaurantOwnerAuthProvider>
  );
}
export { RestaurantOwnerAuthProvider };