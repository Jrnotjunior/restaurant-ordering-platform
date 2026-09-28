import type { ReactNode } from 'react';
import type { RestaurantConfig } from '../types/restaurant';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

type RestaurantLayoutProps = {
  restaurant: RestaurantConfig;
  children: ReactNode;
};

export function RestaurantLayout({ restaurant, children }: RestaurantLayoutProps) {
  return (
    <div className="app-shell">
      <Header restaurant={restaurant} />
      <main>{children}</main>
      <Footer restaurant={restaurant} />
    </div>
  );
}
