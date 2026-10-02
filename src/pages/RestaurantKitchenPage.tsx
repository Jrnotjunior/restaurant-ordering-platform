import { useEffect, useMemo, useState } from 'react';
import { RestaurantOrdersPage } from './RestaurantOrdersPage';
import { getMenu, setProductAvailability } from '../services/menuRepository';
import { supabase } from '../services/supabaseClient';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';

type Props = { restaurantId: string; view?: 'orders' | 'menu' };

export function RestaurantKitchenPage({ restaurantId, view = 'orders' }: Props) {
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchProduct, setSearchProduct] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function loadMenu() {
    try {
      setError('');
      const menu = await getMenu(restaurantId, true);
      setCategories(menu.categories);
      setProducts(menu.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load kitchen menu.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMenu();
  }, [restaurantId]);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel(`kitchen-menu:${restaurantId}`)
      .on('broadcast', { event: 'restaurant_menu_changed' }, () => {
        void loadMenu();
      })
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [restaurantId]);

  const visibleProducts = useMemo(() => {
    const query = searchProduct.trim().toLowerCase();

    return products.filter((product) => {
      const categoryMatch = selectedCategory === 'all' || product.categoryId === selectedCategory;
      const searchMatch = !query || product.name.toLowerCase().includes(query);
      return categoryMatch && searchMatch;
    });
  }, [products, selectedCategory, searchProduct]);

  async function toggleAvailability(product: RestaurantProduct) {
    setSavingId(product.id);
    setError('');

    try {
      await setProductAvailability(product.id, !product.isAvailable, restaurantId);
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id ? { ...item, isAvailable: !item.isAvailable } : item
        )
      );

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update product availability.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="restaurant-menu-page">
      <header className="restaurant-menu-header">
        <div>
          <p className="eyebrow">Kitchen operations</p>
          <h1>Menu</h1>
          <p>View products and update availability for the cashier and customer menu.</p>
        </div>
        <span className="restaurant-dashboard-live-status is-live">
          <span className="restaurant-dashboard-live-dot" />
          Live
        </span>
      </header>

      {error ? <div className="restaurant-dashboard-error" role="alert">{error}</div> : null}

      <div className="restaurant-menu-management-card">
        <div className="restaurant-menu-section-header">
          <div>
            <h2>Product Menu</h2>
            <p>Mark products as sold out or make them available again.</p>
          </div>
        </div>

        <div className="restaurant-menu-search">
          <label className="restaurant-menu-search-label" htmlFor="kitchen-product-search">
            Search products
          </label>
          <div className="restaurant-menu-search-input-wrap">
            <input
              id="kitchen-product-search"
              type="search"
              value={searchProduct}
              onChange={(event) => setSearchProduct(event.target.value)}
              placeholder="Search by product name"
            />
            {searchProduct ? (
              <button
                type="button"
                className="restaurant-menu-search-clear"
                onClick={() => setSearchProduct('')}
                aria-label="Clear product search"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div className="restaurant-menu-toolbar">
          <div className="restaurant-menu-categories" aria-label="Product categories">
            <button
              className={selectedCategory === 'all' ? 'is-active' : ''}
              type="button"
              onClick={() => setSelectedCategory('all')}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                className={selectedCategory === category.id ? 'is-active' : ''}
                type="button"
                onClick={() => setSelectedCategory(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="restaurant-dashboard-empty">Loading products…</div>
        ) : visibleProducts.length === 0 ? (
          <div className="restaurant-dashboard-empty">No products match this filter.</div>
        ) : (
          <div className="restaurant-menu-grid">
            {visibleProducts.map((product) => (
              <article
                className={`restaurant-menu-card ${product.isAvailable ? '' : 'is-unavailable'}`}
                key={product.id}
              >
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" className="restaurant-menu-image" />
                ) : (
                  <div className="restaurant-menu-image-placeholder" aria-hidden="true">
                    {product.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="restaurant-menu-card-content">
                  <div className="restaurant-menu-card-heading">
                    <div>
                      <h2>{product.name}</h2>
                      <p>{product.description || 'No description.'}</p>
                    </div>
                    <strong>₱{product.price.toFixed(2)}</strong>
                  </div>

                  <div className="restaurant-menu-card-footer">
                    <span className={`restaurant-menu-status ${product.isAvailable ? 'is-available' : 'is-unavailable'}`}>
                      {product.isAvailable ? 'Available' : 'Sold Out'}
                    </span>

                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={savingId === product.id}
                      onClick={() => void toggleAvailability(product)}
                    >
                      {savingId === product.id
                        ? 'Saving…'
                        : product.isAvailable
                          ? 'Mark Sold Out'
                          : 'Mark Available'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );

}
