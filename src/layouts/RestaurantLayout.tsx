import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { useRestaurant } from '../components/RestaurantProvider';

type RestaurantLayoutProps = {
  children: ReactNode;
};

export function RestaurantLayout({ children }: RestaurantLayoutProps) {
  useRestaurant();

  return (
    <div className="app-shell">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
