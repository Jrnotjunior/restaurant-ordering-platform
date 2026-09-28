import { RestaurantProvider } from './components/RestaurantProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { RestaurantLayout } from './layouts/RestaurantLayout';
import { defaultRestaurant } from './config/defaultRestaurant';

export function App() {
  return (
    <RestaurantProvider restaurant={defaultRestaurant}>
      <ThemeProvider restaurant={defaultRestaurant}>
        <RestaurantLayout restaurant={defaultRestaurant}>
          <section className="hero">
            <p className="eyebrow">Direct online ordering</p>
            <h1>Order from your favorite local restaurant.</h1>
            <p className="hero-copy">
              Browse the menu, choose pickup or delivery, and place your order directly.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="/menu">View Menu</a>
              <a className="button button-secondary" href="/cart">View Cart</a>
            </div>
          </section>
        </RestaurantLayout>
      </ThemeProvider>
    </RestaurantProvider>
  );
}
