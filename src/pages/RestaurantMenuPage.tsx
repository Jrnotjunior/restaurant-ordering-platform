import { useEffect, useMemo, useState } from 'react';
import { getMenu, setProductAvailability } from '../services/menuRepository';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';

type Props = { restaurantId: string };

export function RestaurantMenuPage({ restaurantId }: Props) {
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUnavailable, setShowUnavailable] = useState(true);
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
      setError(err instanceof Error ? err.message : 'Unable to load menu.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMenu(); }, [restaurantId]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const categoryMatch = selectedCategory === 'all' || product.categoryId === selectedCategory;
    const availabilityMatch = showUnavailable || product.isAvailable;
    return categoryMatch && availabilityMatch;
  }), [products, selectedCategory, showUnavailable]);

  async function toggleAvailability(product: RestaurantProduct) {
    setSavingId(product.id);
    setError('');
    try {
      await setProductAvailability(product.id, !product.isAvailable);
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, isAvailable: !item.isAvailable } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update availability.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="restaurant-menu-page">
      <header className="restaurant-menu-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Menu</h1>
          <p>Control which products customers can order right now.</p>
        </div>
        <span className="restaurant-menu-count">{products.length} products</span>
      </header>

      <nav className="restaurant-dashboard-nav" aria-label="Restaurant navigation">
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/dashboard`}>Dashboard</a>
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/orders`}>Orders</a>
        <a className="is-active" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/menu`}>Menu</a>
      </nav>

      {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

      <div className="restaurant-menu-toolbar">
        <div className="restaurant-menu-categories" aria-label="Menu categories">
          <button className={selectedCategory === 'all' ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory('all')}>All</button>
          {categories.map((category) => <button key={category.id} className={selectedCategory === category.id ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory(category.id)}>{category.name}</button>)}
        </div>
        <label className="restaurant-menu-toggle">
          <input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} />
          <span>Show unavailable</span>
        </label>
      </div>

      {loading ? <div className="restaurant-dashboard-empty">Loading menu…</div> : filteredProducts.length === 0 ? <div className="restaurant-dashboard-empty">No products match this filter.</div> : (
        <div className="restaurant-menu-grid">
          {filteredProducts.map((product) => (
            <article className={`restaurant-menu-card ${product.isAvailable ? '' : 'is-unavailable'}`} key={product.id}>
              {product.imageUrl ? <img src={product.imageUrl} alt="" className="restaurant-menu-image" /> : <div className="restaurant-menu-image-placeholder" aria-hidden="true">{product.name.charAt(0).toUpperCase()}</div>}
              <div className="restaurant-menu-card-content">
                <div className="restaurant-menu-card-heading">
                  <div><h2>{product.name}</h2><p>{product.description || 'No description.'}</p></div>
                  <strong>₱{product.price.toFixed(2)}</strong>
                </div>
                <div className="restaurant-menu-card-footer">
                  <span className={`restaurant-menu-status ${product.isAvailable ? 'is-available' : 'is-unavailable'}`}>{product.isAvailable ? 'Available' : 'Unavailable'}</span>
                  <button className="button button-secondary" type="button" disabled={savingId === product.id} onClick={() => void toggleAvailability(product)}>
                    {savingId === product.id ? 'Saving…' : product.isAvailable ? 'Mark unavailable' : 'Make available'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
