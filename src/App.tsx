import { useEffect, useState } from 'react';
import { RestaurantProvider } from './components/RestaurantProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { MenuPage } from './pages/MenuPage';
import { defaultRestaurant } from './config/defaultRestaurant';
import { currentRestaurantLookup } from './config/restaurant';
import { SupabaseRestaurantRepository } from './services/supabaseRestaurantRepository';
import { isSupabaseConfigured } from './services/supabaseClient';
import type { RestaurantConfig } from './types/restaurant';

const restaurantRepository = new SupabaseRestaurantRepository();

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function getIsMenuPage() {
  return (
    window.location.hash === '#menu' ||
    window.location.pathname.endsWith('/menu') ||
    window.location.pathname.endsWith('/menu/')
  );
}

export function App() {
  const [restaurant, setRestaurant] = useState<RestaurantConfig>(defaultRestaurant);
  const [isMenuPage, setIsMenuPage] = useState(getIsMenuPage);

  useEffect(() => {
    const handleNavigation = () => {
      setIsMenuPage(getIsMenuPage());
    };

    window.addEventListener('hashchange', handleNavigation);
    window.addEventListener('popstate', handleNavigation);

    return () => {
      window.removeEventListener('hashchange', handleNavigation);
      window.removeEventListener('popstate', handleNavigation);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    let cancelled = false;

    restaurantRepository
      .getRestaurant(currentRestaurantLookup)
      .then((loadedRestaurant) => {
        if (!cancelled && loadedRestaurant) {
          setRestaurant(loadedRestaurant);
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to load restaurant from Supabase.', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RestaurantProvider restaurant={restaurant}>
      <ThemeProvider restaurant={restaurant}>
        <RestaurantLayout>
          {isMenuPage ? (
            <MenuPage />
          ) : (
            <section className="hero">
              <p className="eyebrow">Direct online ordering</p>
              <h1>Order from your favorite local restaurant.</h1>
              <p className="hero-copy">
                Browse the menu, choose pickup or delivery, and place your order directly.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href={withBasePath('/menu')}>View Menu</a>
                <a className="button button-secondary" href={withBasePath('/cart')}>View Cart</a>
              </div>
            </section>
          )}
        </RestaurantLayout>
      </ThemeProvider>
    </RestaurantProvider>
  );
}
