import { useEffect, useState, type ReactNode } from 'react';
import { RestaurantProvider } from './components/RestaurantProvider';
import { OwnerUnsavedChangesProvider } from './contexts/OwnerUnsavedChangesContext';
import { RestaurantOwnerAuthProvider, useRestaurantOwnerAuth } from './components/RestaurantOwnerAuthProvider';
import { PrivilegedMfaGate } from './modules/auth/components/PrivilegedMfaGate';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { MenuPage } from './pages/MenuPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { RestaurantOrdersPage } from './pages/RestaurantOrdersPage';
import { RestaurantMenuPage } from './pages/RestaurantMenuPage';
import { RestaurantSalesPage } from './pages/RestaurantSalesPage';
import { RestaurantBusinessReportsPage } from './pages/RestaurantBusinessReportsPage';
import { RestaurantInventoryPage } from './pages/RestaurantInventoryPage';
import { RestaurantRecipesPage } from './pages/RestaurantRecipesPage';
import { RestaurantCashierPosPage } from './pages/RestaurantCashierPosPage';
import { RestaurantDeliveryDispatchPage } from './pages/RestaurantDeliveryDispatchPage';
import { RestaurantSettingsPage } from './pages/RestaurantSettingsPage';
import { RestaurantWebsiteCustomizationPage } from './pages/RestaurantWebsiteCustomizationPage';
import { RestaurantLoyaltyPage } from './pages/RestaurantLoyaltyPage';
import { RestaurantOwnerLoginPage } from './pages/RestaurantOwnerLoginPage';
import { RestaurantEmployeesPage } from './pages/RestaurantEmployeesPage';
import { RestaurantPayrollPage } from './pages/RestaurantPayrollPage';
import { RestaurantEmployeeInvitePage } from './pages/RestaurantEmployeeInvitePage';
import { RestaurantRoleDashboardPage } from './pages/RestaurantRoleDashboardPage';
import { RestaurantKitchenPage } from './pages/RestaurantKitchenPage';
import { CustomerSignUpPage } from './pages/CustomerSignUpPage';
import { CustomerPasswordRecoveryPage } from './pages/CustomerPasswordRecoveryPage';
import { CustomerEmailConfirmationPage } from './pages/CustomerEmailConfirmationPage';
import { PrivacyNoticePage } from './pages/PrivacyNoticePage';
import { CustomerPolicyPage } from './pages/CustomerPolicyPage';
import { LegalPoliciesPage } from './pages/LegalPoliciesPage';
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
import { useRestaurantBranches } from './modules/branches/useRestaurantBranches';
import { BranchSelector } from './modules/branches/components/BranchSelector';
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
  if (path === '/restaurant/business-reports') return `${base}/#restaurant/business-reports`;
  if (path === '/restaurant/inventory') return `${base}/#restaurant/inventory`;
  if (path === '/restaurant/recipes') return `${base}/#restaurant/recipes`;
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
  const [restaurantResolved, setRestaurantResolved] = useState(false);
  const [route, setRoute] = useState(() => normalizeHashRoute(window.location.hash || ''));
  const { user, loading: authLoading, error: authError } = useRestaurantOwnerAuth();
  const { branches, selectedBranch, selectBranch, loading: branchesLoading, error: branchesError } = useRestaurantBranches(restaurant.id);
  useEffect(() => {
    const favicon = restaurant.storefront.faviconUrl?.trim();
    const iconLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    let link = iconLinks.shift();

    // Remove duplicate icon declarations, then keep one neutral data URL when
    // this restaurant has no uploaded favicon. Without any icon link, browsers
    // automatically request /favicon.ico from the site root.
    iconLinks.forEach((duplicate) => duplicate.remove());

    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    link.dataset.restaurantFavicon = 'true';
    link.href = favicon || 'data:,';
    link.type = '';
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
        if (cancelled) return;
        if (loadedRestaurant) setRestaurant(loadedRestaurant);
        setRestaurantResolved(true);
      })
      .catch((error: unknown) => {
        console.error('Unable to load restaurant from Supabase.', error);
        if (!cancelled) setRestaurantResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const [showStoreClosedModal, setShowStoreClosedModal] = useState(false);

  async function addToCart(product: RestaurantProduct) {
    if (!selectedBranch) return;
    const storeOpen = selectedBranch.ordering_enabled !== false
      && isRestaurantCurrentlyOpen(selectedBranch.operating_hours as RestaurantConfig['operatingHours'] | undefined);

    if (!storeOpen) {
      setShowStoreClosedModal(true);
      return;
    }

    addCartItem(product);
  }

  function handleSelectBranch(branchId: string) {
    if (selectedBranch?.id === branchId) return;
    if (cartCount > 0) {
      const accepted = window.confirm('Switching branches will clear the current cart so items are not ordered from the wrong location. Continue?');
      if (!accepted) return;
      clearCart();
    }
    [
      'restaurant-ordering-pending-payment-checkout-url',
      'restaurant-ordering-pending-payment-reference',
      'restaurant-ordering-pending-payment-cart-user',
      'restaurant-ordering-pending-payment-pickup-method',
      'restaurant-ordering-pending-payment-order',
    ].forEach((key) => window.localStorage.removeItem(key));
    selectBranch(branchId);
  }

  const routeContext = resolveAppRoute(window.location, route);
  const {
    isMenuPage,
    isCartPage,
    isAccountPage,
    isStaffLoginPage,
    isSignUpPage,
    isCustomerEmailConfirmationPage,
    isCustomerPasswordResetPage,
    isCustomerForgotPasswordPage,
    isLegalPoliciesPage,
    isPrivacyPage,
    isTermsPage,
    isRefundsPage,
    isCheckoutPage,
    trackOrderNumber,
    isRestaurantOrdersPage,
    isRestaurantMenuPage,
    isRestaurantSalesPage,
    isRestaurantBusinessReportsPage,
    isRestaurantInventoryPage,
    isRestaurantRecipesPage,
    isCashierSalesPage,
    isCashierPosPage,
    isRestaurantDeliveryDispatchPage,
    isRestaurantSettingsPage,
    isRestaurantWebsiteCustomizationPage,
    isRestaurantLoyaltyPage,
    isRestaurantEmployeesPage,
    isRestaurantPayrollPage,
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

  // Custom domains for POS-only tenants are staff entry points, not public
  // customer storefronts. Resolve the module for this exact tenant before
  // redirecting; never infer access from the hostname or restaurant name.
  useEffect(() => {
    const hostname = window.location.hostname.trim().toLowerCase();
    const isCustomDomain = hostname !== 'localhost'
      && hostname !== '127.0.0.1'
      && hostname !== '::1'
      && hostname !== 'github.io'
      && !hostname.endsWith('.github.io');
    const isPublicOrderingRoute = !route
      || route === '#menu'
      || route === '#cart'
      || route === '#checkout'
      || route.startsWith('#order/');
    if (!isCustomDomain || !restaurant.id || !isPublicOrderingRoute || !supabase) return;

    let cancelled = false;
    void supabase.rpc('public_restaurant_has_module', {
      p_restaurant_id: restaurant.id,
      p_module_key: 'self_ordering',
    }).then(({ data, error }) => {
      if (cancelled || error || data !== false) return;
      window.location.hash = '#account';
    });
    return () => { cancelled = true; };
  }, [restaurant.id, route]);

  if (isTenantInviteLandingPage) return <TenantInviteLandingPage />;
  if (isTenantInvitePage) return <TenantOnboardingPage />;
  if (isEmployeeInvitePage) return <RestaurantEmployeeInvitePage />;
  if (isLegacyEmployeeInvitePage) return <RestaurantEmployeeInvitePage />;

  const isCustomerConfirmationCallback = isCustomerEmailConfirmationPage
    || new URLSearchParams(window.location.search).get('customer-confirmation') === '1';

  if (isCustomerPasswordResetPage) return <CustomerPasswordRecoveryPage mode="reset" />;
  if (isCustomerForgotPasswordPage) return <CustomerPasswordRecoveryPage mode="request" />;
  if (isSignUpPage) return <CustomerSignUpPage />;
  if (isCustomerConfirmationCallback) return <CustomerEmailConfirmationPage />;

  if (isLegalPoliciesPage) return <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><LegalPoliciesPage /></RestaurantLayout></ThemeProvider></RestaurantProvider>;
  if (isPrivacyPage) return <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><PrivacyNoticePage /></ThemeProvider></RestaurantProvider>;
  if (isTermsPage) return <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><CustomerPolicyPage kind="terms" /></ThemeProvider></RestaurantProvider>;
  if (isRefundsPage) return <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><CustomerPolicyPage kind="refunds" /></ThemeProvider></RestaurantProvider>;
  if (route === '#saved-address') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><SavedAddressPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (route === '#order-history') return <PublicCustomerRouteGuard><RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount}><CustomerOrderHistoryPage /></RestaurantLayout></ThemeProvider></RestaurantProvider></PublicCustomerRouteGuard>;
  if (isAccountPage) return <RestaurantOwnerLoginPage />;
  if (isStaffLoginPage) return <RestaurantOwnerLoginPage staffOnly />;
  if (isRiderDashboardPage) return <RiderRouteGuard><RiderDashboardPage /></RiderRouteGuard>;
  if (riderDeliveryMatch) return <RiderRouteGuard><RiderDeliveryPage orderId={decodeURIComponent(riderDeliveryMatch[1])} /></RiderRouteGuard>;

  const trackingOrderId = trackOrderNumber || (trackingMatch ? decodeURIComponent(trackingMatch[1]) : null);
  const publicContent = trackingOrderId
    ? restaurantResolved
      ? <OrderTrackingPage orderId={trackingOrderId} expectedRestaurantId={restaurant.id ?? null} />
      : <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>Loading restaurant…</h1><p>Please wait while we verify this storefront.</p></div></section>
    : isMenuPage || (!isCartPage && !isCheckoutPage && !trackingMatch)
      ? <MenuPage onAddToCart={addToCart} cartCount={cartCount} />
      : isCartPage
        ? <CartPage items={cartItems} onIncrease={increaseCartItem} onDecrease={decreaseCartItem} onRemove={removeCartItem} />
        : isCheckoutPage
          ? <CheckoutPage items={cartItems} onClearCart={clearCart} branch={selectedBranch} />
          : <MenuPage onAddToCart={addToCart} cartCount={cartCount} />;

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
          <OwnerUnsavedChangesProvider>
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
              : isRestaurantPayrollPage ? <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['payroll']}><RestaurantPayrollPage restaurantId={ownerRestaurant.id!} /></RestaurantModuleGuard>
              : isRestaurantDeliveryDispatchPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['dispatch_delivery']}>
                  <RestaurantDeliveryDispatchPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantSalesPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['sales']}>
                  <RestaurantSalesPage restaurantId={ownerRestaurant.id!} role="owner" />
                </RestaurantModuleGuard>
              ) : isRestaurantBusinessReportsPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['sales']}>
                  <RestaurantBusinessReportsPage restaurantId={ownerRestaurant.id!} />
                </RestaurantModuleGuard>
              ) : isRestaurantRecipesPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['sales']}><RestaurantRecipesPage restaurantId={ownerRestaurant.id!} /></RestaurantModuleGuard>
              ) : isRestaurantInventoryPage ? (
                <RestaurantModuleGuard restaurantId={ownerRestaurant.id!} anyOf={['sales']}>
                  <RestaurantInventoryPage restaurantId={ownerRestaurant.id!} />
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
          </OwnerUnsavedChangesProvider>
        </ThemeProvider>
      </RestaurantProvider>
    )}</OwnerRestaurantGuard>;
  }

  const isPublicMenuView = isMenuPage || (!isCartPage && !isCheckoutPage && !trackingMatch && !trackOrderNumber);
  const isStoreOrderingRoute = isMenuPage || isCartPage || isCheckoutPage;
  const branchAwarePublicContent = !isStoreOrderingRoute ? publicContent : branchesLoading
    ? <section className="order-tracking-page"><div className="order-tracking-card"><h1>Loading branches…</h1><p>Please wait while we load this restaurant's locations.</p></div></section>
    : branchesError
      ? <section className="order-tracking-page"><div className="order-tracking-card"><h1>Branches unavailable</h1><p role="alert">{branchesError}</p><p>Ordering is paused until the branch configuration can be verified.</p></div></section>
      : branches.length === 0
        ? <section className="order-tracking-page"><div className="order-tracking-card"><h1>No active branches</h1><p>This restaurant has no active branch available for ordering. Please contact the restaurant.</p></div></section>
        : <><BranchSelector branches={branches} selectedBranch={selectedBranch} onSelect={handleSelectBranch} disabled={route === '#checkout'} />{selectedBranch ? publicContent : null}</>;

  const publicPage = <RestaurantProvider restaurant={restaurant}><ThemeProvider restaurant={restaurant}><RestaurantLayout cartCount={cartCount} compactPublicChrome>{branchAwarePublicContent}{showStoreClosedModal ? (
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
      <PrivilegedMfaGate>
        <AppContent />
      </PrivilegedMfaGate>
    </RestaurantOwnerAuthProvider>
  );
}
export { RestaurantOwnerAuthProvider };