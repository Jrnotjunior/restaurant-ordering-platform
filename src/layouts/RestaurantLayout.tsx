import type { ReactNode } from 'react';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { useRestaurant } from '../components/RestaurantProvider';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';

type RestaurantLayoutProps = {
  children: ReactNode;
  hideChrome?: boolean;
};

export function RestaurantLayout({ children, hideChrome = false }: RestaurantLayoutProps) {
  useRestaurant();
  const { user, restaurant, signOut } = useRestaurantOwnerAuth();

  if (hideChrome) {
    return (
      <main className="restaurant-operations-shell">
        {user && restaurant && (
          <div className="restaurant-operations-account-bar">
            <div>
              <strong>{restaurant.name}</strong>
              <span>{user.email}</span>
            </div>
            <button className="restaurant-operations-signout" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        )}
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
