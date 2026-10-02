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
    <section className="restaurant-kitchen-page">
      {view === 'orders' ? <RestaurantOrdersPage restaurantId={restaurantId} role="kitchen" /> : null}

      {view === 'menu' ? (
        <div className="restaurant-kitchen-products-section">
      <style>{`
        .restaurant-kitchen-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
        .restaurant-kitchen-header h1{margin-bottom:6px}
        .restaurant-kitchen-panel{border:1px solid #e1e5eb;border-radius:14px;padding:18px;margin-top:22px;background:#fff}
        .restaurant-kitchen-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0}
        .restaurant-kitchen-search{width:100%;max-width:360px;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-kitchen-search:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-kitchen-categories{display:flex;gap:8px;flex-wrap:wrap}
        .restaurant-kitchen-categories button{border:1px solid #dbe2ea;background:#fff;border-radius:999px;padding:8px 12px;cursor:pointer;color:#475569}
        .restaurant-kitchen-categories button.is-active{background:#0f172a;color:#fff;border-color:#0f172a}
        .restaurant-kitchen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
        .restaurant-kitchen-card{border:1px solid #e1e5eb;border-radius:12px;padding:14px;background:#fff}
        .restaurant-kitchen-card.is-sold-out{background:#f8fafc}
        .restaurant-kitchen-image{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:9px;background:#f1f5f9}
        .restaurant-kitchen-image-placeholder{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/10;border-radius:9px;background:#f1f5f9;color:#64748b;font-size:28px;font-weight:700}
        .restaurant-kitchen-card h2{margin:12px 0 5px;font-size:17px}
        .restaurant-kitchen-card p{margin:0;color:#64748b;font-size:13px}
        .restaurant-kitchen-card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
        .restaurant-kitchen-status{font-size:12px;font-weight:700}
        .restaurant-kitchen-status.is-available{color:#166534}
        .restaurant-kitchen-status.is-sold-out{color:#b91c1c}
        .restaurant-kitchen-card button{white-space:nowrap}
        @media(max-width:600px){.restaurant-kitchen-search{max-width:none}.restaurant-kitchen-grid{grid-template-columns:1fr}}
      `}</style>

      <header className="restaurant-kitchen-header">
        <div>
          <p className="eyebrow">Kitchen operations</p>
          <h1>Menu</h1>
          <p>View products and update availability for the cashier and customer menu.</p>
        </div>
        <span aria-live="polite">Live</span>
      </header>

      {error ? <div className="restaurant-dashboard-error" role="alert">{error}</div> : null}

      <div className="restaurant-kitchen-panel">
        <input
          className="restaurant-kitchen-search"
          type="search"
          value={searchProduct}
          onChange={(event) => setSearchProduct(event.target.value)}
          placeholder="Search products"
          aria-label="Search products"
        />

        <div className="restaurant-kitchen-toolbar">
          <div className="restaurant-kitchen-categories" aria-label="Product categories">
            <button className={selectedCategory === 'all' ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory('all')}>
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
          <div className="restaurant-dashboard-empty">No products found.</div>
        ) : (
          <div className="restaurant-kitchen-grid">
            {visibleProducts.map((product) => (
              <article className={`restaurant-kitchen-card${product.isAvailable ? '' : ' is-sold-out'}`} key={product.id}>
                {product.imageUrl ? (
                  <img className="restaurant-kitchen-image" src={product.imageUrl} alt="" />
                ) : (
                  <div className="restaurant-kitchen-image-placeholder" aria-hidden="true">
                    {product.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <h2>{product.name}</h2>
                <p>₱{product.price.toFixed(2)}</p>

                <div className="restaurant-kitchen-card-footer">
                  <span className={`restaurant-kitchen-status${product.isAvailable ? ' is-available' : ' is-sold-out'}`}>
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
              </article>
            ))}
          </div>
        )}
        </div>
        </div>
      ) : null}
    </section>
  );
}
