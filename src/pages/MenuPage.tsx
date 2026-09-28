import { useEffect, useMemo, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { useRestaurant } from '../components/RestaurantProvider';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { getMenu } from '../services/menuRepository';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';

type MenuPageProps = {
  onAddToCart: (product: RestaurantProduct) => void;
  cartCount: number;
};

export function MenuPage({ onAddToCart, cartCount }: MenuPageProps) {
  const restaurant = useRestaurant();
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!restaurant.id || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    getMenu(restaurant.id)
      .then((menu) => {
        if (cancelled) return;
        setCategories(menu.categories);
        setProducts(menu.products);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        console.error('Unable to load restaurant menu.', loadError);
        setError('We could not load the menu right now. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [restaurant.id]);

  const visibleProducts = useMemo(
    () => selectedCategory === 'all'
      ? products
      : products.filter((product) => product.categoryId === selectedCategory),
    [products, selectedCategory]
  );

  const cartHref = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/#cart`;

  return (
    <section className="menu-page">
      <div className="menu-intro">
        <p className="eyebrow">Our menu</p>
        <h1>Choose what you’re craving.</h1>
        <p>Browse available items and add your favorites to your order.</p>
        {cartCount > 0 ? (
          <a className="menu-cart-link" href={cartHref}>
            View cart · {cartCount} {cartCount === 1 ? 'item' : 'items'}
          </a>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <div className="menu-categories" role="tablist" aria-label="Menu categories">
          <button
            className={`menu-category-button ${selectedCategory === 'all' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setSelectedCategory('all')}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              className={`menu-category-button ${selectedCategory === category.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => setSelectedCategory(category.id)}
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <p className="menu-state">Loading menu…</p> : null}
      {!loading && error ? <p className="menu-state menu-state-error">{error}</p> : null}
      {!loading && !error && !isSupabaseConfigured ? (
        <p className="menu-state">Connect Supabase to load the restaurant menu.</p>
      ) : null}
      {!loading && !error && isSupabaseConfigured && products.length === 0 ? (
        <p className="menu-state">No menu items are available yet.</p>
      ) : null}

      {!loading && !error && visibleProducts.length > 0 ? (
        <div className="menu-product-grid">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
