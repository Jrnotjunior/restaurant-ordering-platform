import { useEffect, useMemo, useState } from 'react';
import { deleteProduct, getMenu, setProductAvailability, updateProduct } from '../services/menuRepository';
import type { RestaurantCategory, RestaurantProduct } from '../types/menu';

type Props = { restaurantId: string };
type ProductForm = { name: string; description: string; price: string; categoryId: string };

const emptyForm: ProductForm = { name: '', description: '', price: '', categoryId: '' };

export function RestaurantMenuPage({ restaurantId }: Props) {
  const [categories, setCategories] = useState<RestaurantCategory[]>([]);
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUnavailable, setShowUnavailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editingProduct, setEditingProduct] = useState<RestaurantProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [savingForm, setSavingForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadMenu() {
    try {
      setError('');
      const menu = await getMenu(restaurantId, true);
      setCategories(menu.categories);
      setProducts(menu.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load products.');
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

  function openEdit(product: RestaurantProduct) {
    setEditingProduct(product);
    setForm({ name: product.name, description: product.description, price: String(product.price), categoryId: product.categoryId });
    setError('');
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;
    const name = form.name.trim();
    const price = Number(form.price);
    if (!name) { setError('Product name is required.'); return; }
    if (!Number.isFinite(price) || price < 0) { setError('Enter a valid price.'); return; }
    if (!form.categoryId) { setError('Select a category.'); return; }
    setSavingForm(true);
    setError('');
    try {
      await updateProduct(editingProduct, { name, description: form.description, price, categoryId: form.categoryId });
      setProducts((current) => current.map((item) => item.id === editingProduct.id ? { ...item, name, description: form.description.trim(), price, categoryId: form.categoryId, updatedAt: new Date().toISOString() } : item));
      setEditingProduct(null);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update product.');
    } finally {
      setSavingForm(false);
    }
  }

  async function removeProduct(product: RestaurantProduct) {
    const confirmed = window.confirm(`Delete ${product.name}?\n\nThis will remove the product from the restaurant products list.`);
    if (!confirmed) return;
    setDeletingId(product.id);
    setError('');
    try {
      await deleteProduct(product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete product.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="restaurant-menu-page">
      <style>{`
        .restaurant-menu-card-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}
        .restaurant-menu-card-actions .button{min-height:38px}
        .restaurant-product-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
        .restaurant-product-modal{position:relative;width:min(520px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}
        .restaurant-product-modal h2{margin:0 42px 18px 0}
        .restaurant-product-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;cursor:pointer}
        .restaurant-product-form{display:grid;gap:14px}
        .restaurant-product-form label{display:grid;gap:6px;font-weight:600;font-size:14px}
        .restaurant-product-form input,.restaurant-product-form textarea,.restaurant-product-form select{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-product-form textarea{min-height:90px;resize:vertical}
        .restaurant-product-form-actions{display:flex;justify-content:center;gap:10px;margin-top:4px}
        .restaurant-product-form-actions .button{min-width:130px}
        @media(max-width:600px){.restaurant-product-modal-backdrop{padding:10px;align-items:flex-end}.restaurant-product-modal{max-height:92vh;overflow:auto;border-radius:18px 18px 12px 12px;padding:20px}.restaurant-product-form-actions .button{flex:1}}
      `}</style>

      <header className="restaurant-menu-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Products</h1>
          <p>Manage the products customers can order from your restaurant.</p>
        </div>
        <span className="restaurant-menu-count">{products.length} products</span>
      </header>

      <nav className="restaurant-dashboard-nav" aria-label="Restaurant navigation">
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/dashboard`}>Dashboard</a>
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/orders`}>Orders</a>
        <a className="is-active" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/menu`}>Products</a>
      </nav>

      {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

      <div className="restaurant-menu-toolbar">
        <div className="restaurant-menu-categories" aria-label="Product categories">
          <button className={selectedCategory === 'all' ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory('all')}>All</button>
          {categories.map((category) => <button key={category.id} className={selectedCategory === category.id ? 'is-active' : ''} type="button" onClick={() => setSelectedCategory(category.id)}>{category.name}</button>)}
        </div>
        <label className="restaurant-menu-toggle">
          <input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} />
          <span>Show unavailable</span>
        </label>
      </div>

      {loading ? <div className="restaurant-dashboard-empty">Loading products…</div> : filteredProducts.length === 0 ? <div className="restaurant-dashboard-empty">No products match this filter.</div> : (
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
                <div className="restaurant-menu-card-actions">
                  <button className="button button-secondary" type="button" disabled={deletingId === product.id} onClick={() => openEdit(product)}>Edit</button>
                  <button className="button button-secondary" type="button" disabled={deletingId === product.id} onClick={() => void removeProduct(product)}>{deletingId === product.id ? 'Deleting…' : 'Delete'}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editingProduct && (
        <div className="restaurant-product-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingForm) setEditingProduct(null); }}>
          <div className="restaurant-product-modal" role="dialog" aria-modal="true" aria-labelledby="edit-product-title">
            <button className="restaurant-product-modal-close" type="button" disabled={savingForm} onClick={() => setEditingProduct(null)}>×</button>
            <h2 id="edit-product-title">Edit Product</h2>
            <form className="restaurant-product-form" onSubmit={(event) => void saveEdit(event)}>
              <label>Product name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
              <label>Price<input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} /></label>
              <label>Category<select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <div className="restaurant-product-form-actions">
                <button className="button button-secondary" type="button" disabled={savingForm} onClick={() => setEditingProduct(null)}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={savingForm}>{savingForm ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
