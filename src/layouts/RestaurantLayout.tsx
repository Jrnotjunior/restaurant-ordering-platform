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
};

export function RestaurantLayout({ children, hideChrome = false, cartCount = 0, role = 'owner' }: RestaurantLayoutProps) {
  useRestaurant();

  if (hideChrome) {
    return (
      <main className={`restaurant-operations-shell${role === 'owner' ? ' restaurant-operations-shell-owner' : ''}`}>
        <RestaurantNavigation role={role} />
        {children}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Header cartCount={cartCount} />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
