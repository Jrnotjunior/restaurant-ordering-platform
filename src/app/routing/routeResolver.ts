export type AppRouteContext = {
  route: string;
  isMenuPage: boolean;
  isCartPage: boolean;
  isAccountPage: boolean;
  isSignUpPage: boolean;
  isCustomerEmailConfirmationPage: boolean;
  isCustomerPasswordResetPage: boolean;
  isCustomerForgotPasswordPage: boolean;
  isPrivacyPage: boolean;
  isCheckoutPage: boolean;
  trackOrderNumber: string | null;
  isRestaurantOrdersPage: boolean;
  isRestaurantMenuPage: boolean;
  isRestaurantSalesPage: boolean;
  isCashierSalesPage: boolean;
  isCashierPosPage: boolean;
  isRestaurantDeliveryDispatchPage: boolean;
  isRestaurantSettingsPage: boolean;
  isRestaurantWebsiteCustomizationPage: boolean;
  isRestaurantLoyaltyPage: boolean;
  isRestaurantEmployeesPage: boolean;
  isCashierPage: boolean;
  isKitchenPage: boolean;
  isKitchenMenuPage: boolean;
  isDispatcherPage: boolean;
  restaurantRoleRoute: 'owner' | 'cashier' | 'kitchen' | 'dispatcher' | undefined;
  isRiderDashboardPage: boolean;
  riderDeliveryMatch: RegExpMatchArray | null;
  isLegacyEmployeeInvitePath: boolean;
  isLegacyEmployeeInvitePage: boolean;
  isEmployeeInvitePage: boolean;
  isTenantInviteLandingPage: boolean;
  isTenantInvitePage: boolean;
  isRestaurantOperationsPage: boolean;
  trackingMatch: RegExpMatchArray | null;
};

export function normalizeHashRoute(hash: string) {
  const normalized = hash.replace(/^#\//, '#');
  return normalized === '#menu' ? '' : normalized;
}

export function resolveAppRoute(location: Pick<Location, 'pathname' | 'search' | 'hash'>, route: string): AppRouteContext {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(location.search);

  const isMenuPage = route === '#menu' || location.pathname.endsWith('/menu') || location.pathname.endsWith('/menu/');
  const isCartPage = route === '#cart';
  const isAccountPage = route === '#account';
  const isSignUpPage = route === '#signup';
  const isCustomerEmailConfirmationPage = route === '#signup-confirmation';
  const isCustomerPasswordResetPage = searchParams.get('customer-password-reset') === '1';
  const isCustomerForgotPasswordPage = route === '#forgot-password';
  const isPrivacyPage = route === '#privacy';
  const isCheckoutPage = route === '#checkout';
  const trackOrderNumber = searchParams.get('trackOrder');

  const isRestaurantOrdersPage = route === '#restaurant/orders';
  const isRestaurantMenuPage = route === '#restaurant/menu';
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

  const restaurantRoleRoute =
    route.match(/^#restaurant\/(owner|cashier|kitchen|dispatcher)$/)?.[1] as
      | 'owner'
      | 'cashier'
      | 'kitchen'
      | 'dispatcher'
      | undefined;

  const isRiderDashboardPage = route === '#rider/dashboard' || route === '#rider/delivery-preview';
  const riderDeliveryMatch = route.match(/^#rider\/delivery\/([^/]+)$/);
  // Older staff invitation links are retained, but all staff roles use the shared invitation page.
  const isLegacyEmployeeInvitePath =
    location.pathname.endsWith('/invite') || location.pathname.endsWith('/invite/');
  const isLegacyEmployeeInvitePage = isLegacyEmployeeInvitePath || searchParams.get('invite') === '1';
  const nestedConfirmationUrl = searchParams.get('confirmation_url') ?? '';
  let nestedEmployeeInvite = false;
  if (nestedConfirmationUrl) {
    try {
      const nested = new URL(nestedConfirmationUrl, 'https://invalid.local');
      nestedEmployeeInvite = nested.searchParams.get('employee-invite') === '1'
        || nested.pathname.endsWith('/employee-invite')
        || nested.pathname.endsWith('/employee-invite/');
    } catch {
      nestedEmployeeInvite = nestedConfirmationUrl.includes('employee-invite=1');
    }
  }

  const isEmployeeInvitePage =
    location.pathname.endsWith('/employee-invite') ||
    location.pathname.endsWith('/employee-invite/') ||
    searchParams.get('employee-invite') === '1' ||
    nestedEmployeeInvite;

  // Only explicit tenant markers can enter the tenant flow. A bare
  // token_hash is deliberately excluded because customer confirmations use
  // the same Supabase Auth callback parameters.
  const isTenantInviteLandingPage =
    searchParams.get('invitation') === '1' ||
    (searchParams.has('confirmation_url') && !nestedEmployeeInvite) ||
    searchParams.get('tenant-owner-access') === '1' ||
    (searchParams.get('tenant-invite') === '1' && searchParams.get('tenant-onboarding') !== '1');

  const isTenantInvitePage =
    (searchParams.get('tenant-invite') === '1' && searchParams.get('tenant-onboarding') === '1') ||
    (hashParams.get('type') === 'invite' && searchParams.get('tenant-invite') === '1');

  const isRestaurantOperationsPage =
    isRestaurantOrdersPage ||
    isRestaurantMenuPage ||
    isRestaurantSalesPage ||
    isRestaurantDeliveryDispatchPage ||
    isRestaurantSettingsPage ||
    isRestaurantWebsiteCustomizationPage ||
    isRestaurantLoyaltyPage ||
    isRestaurantEmployeesPage;

  const trackingMatch = route.match(/^#order\/(.+)$/);

  return {
    route,
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
    isLegacyEmployeeInvitePath,
    isLegacyEmployeeInvitePage,
    isEmployeeInvitePage,
    isTenantInviteLandingPage,
    isTenantInvitePage,
    isRestaurantOperationsPage,
    trackingMatch,
  };
}
