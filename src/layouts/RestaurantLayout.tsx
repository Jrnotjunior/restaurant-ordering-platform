import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { RestaurantNavigation } from '../components/RestaurantNavigation';
import { useRestaurant } from '../components/RestaurantProvider';

type RestaurantLayoutProps = {
  children: ReactNode;
  hideChrome?: boolean;
};

export function RestaurantLayout({ children, hideChrome = false }: RestaurantLayoutProps) {
  useRestaurant();

  if (hideChrome) {
    return (
      <main className="restaurant-operations-shell">
        <RestaurantNavigation />
        {children}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
