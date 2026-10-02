import { useEffect, useMemo, useRef, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { useRestaurant } from '../components/RestaurantProvider';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { getMenu } from '../services/menuRepository';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';
import '../styles/menu-category.css';

type MenuPageProps = {
  onAddToCart: (product: RestaurantProduct) => void;
  cartCount: number;
};

export function MenuPage({ onAddToCart, cartCount }: MenuPageProps) {
  const restaurant = useRestaurant();
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categorySelectRef = useRef<HTMLDivElement>(null);
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

    getMenu(restaurant.id, true)
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

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!categorySelectRef.current?.contains(event.target as Node)) setCategoryOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectedCategoryName = selectedCategory === 'all'
    ? 'All products'
    : categories.find((category) => category.id === selectedCategory)?.name ?? 'All products';

  const visibleProducts = useMemo(
    () => selectedCategory === 'all'
      ? products
      : products.filter((product) => product.categoryId === selectedCategory),
    [products, selectedCategory]
  );

  return (
    <section className="menu-page">
      <div className="menu-intro">
        <p className="eyebrow">Our menu</p>
        <h1>Choose what you’re craving.</h1>
        <p>Browse available items and add your favorites to your order.</p>
      </div>

      {categories.length > 0 ? (
        <>
        <div className="menu-category-select menu-category-desktop">
          <label htmlFor="menu-category-desktop">Category</label>
          <select
            id="menu-category-desktop"
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
          >
            <option value="all">All products</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="menu-category-select menu-category-mobile" ref={categorySelectRef}>
          <span className="menu-category-label">Category</span>
          <div className="menu-category-dropdown">
            <button
              className="menu-category-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={categoryOpen}
              onClick={() => setCategoryOpen((open) => !open)}
            >
              <span>{selectedCategoryName}</span>
              <span className={`menu-category-chevron ${categoryOpen ? 'is-open' : ''}`} aria-hidden="true">⌄</span>
            </button>
            {categoryOpen ? (
              <div className="menu-category-options" role="listbox" aria-label="Menu categories">
                <button
                  className={`menu-category-option ${selectedCategory === 'all' ? 'is-selected' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={selectedCategory === 'all'}
                  onClick={() => { setSelectedCategory('all'); setCategoryOpen(false); }}
                >
                  All products
                </button>
                {categories.map((category) => (
                  <button
                    className={`menu-category-option ${selectedCategory === category.id ? 'is-selected' : ''}`}
                    key={category.id}
                    type="button"
                    role="option"
                    aria-selected={selectedCategory === category.id}
                    onClick={() => { setSelectedCategory(category.id); setCategoryOpen(false); }}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        </>
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
