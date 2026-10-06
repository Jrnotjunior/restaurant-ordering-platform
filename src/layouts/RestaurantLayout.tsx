import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { RestaurantNavigation, type RestaurantNavigationRole } from '../components/RestaurantNavigation';
import { useRestaurant } from '../components/RestaurantProvider';

type RestaurantLayoutProps = {
  children: ReactNode;
  hideChrome?: boolean;
  cartCount?: number;
  role?: RestaurantNavigationRole;
  ownerDashboard?: boolean;
  compactPublicChrome?: boolean;
};

export function RestaurantLayout({ children, hideChrome = false, cartCount = 0, role = 'owner', ownerDashboard = false, compactPublicChrome = false }: RestaurantLayoutProps) {
  useRestaurant();

  if (hideChrome) {
    return (
      <main className={`restaurant-operations-shell${role === 'owner' && ownerDashboard ? ' restaurant-operations-shell-owner' : ''}`}>
        <RestaurantNavigation role={role} ownerDashboard={ownerDashboard} />
        {children}
      </main>
    );
  }

  return (
    <div className={`app-shell${compactPublicChrome ? ' app-shell-compact-public' : ''}`}>
      <Header cartCount={cartCount} />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
